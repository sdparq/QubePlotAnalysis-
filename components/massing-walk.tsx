"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Sky, Edges, Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, N8AO, Bloom, Vignette } from "@react-three/postprocessing";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import type { Point } from "@/lib/geom";
import { isCounterClockwise, offsetPolygon, polygonBBox, polygonCentroid } from "@/lib/geom";
import type { Volume } from "@/lib/massing";
import { planPodiumAmenities } from "@/lib/podium-amenities";
import { renderSchemeWithGemini, DEFAULT_WALK_HYPERREAL_PROMPT } from "@/lib/ai-render";
import {
  PodiumAmenities,
  ResidentialFacade,
  VerticalFinScreen,
  colourForKind,
  polyToShape,
  ROAD_W,
  SIDEWALK_W,
  type FacadeParams,
} from "./massing-scene";

const EYE_H = 1.7;      // camera eye height (m)
const WALK_SPEED = 4.5; // m/s
const RUN_SPEED = 9.5;  // m/s with Shift

export interface WalkProps {
  plot: Point[];
  volumes: Volume[];
  floorHeight: number;
  facade: FacadeParams;
  /** Exact storey counts / heights header, prepended to the AI render prompt. */
  geometryFacts?: string;
  onExit: () => void;
}

/** Deterministic hash → [0,1) so the streetscape is stable between visits. */
function hash01(i: number, salt = 0): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Sample points along a polygon's edges at roughly the given spacing. */
function sampleAlongPolygon(poly: Point[], spacing: number, salt = 0) {
  const out: { x: number; y: number; yaw: number; nx: number; ny: number; t: number }[] = [];
  if (poly.length < 3) return out;
  const ccw = isCounterClockwise(poly);
  const outSign = ccw ? 1 : -1;
  let globalIdx = 0;
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e];
    const b = poly[(e + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < spacing * 0.6) continue;
    const ux = ex / len, uy = ey / len;
    const nx = uy * outSign, ny = -ux * outSign;
    const yaw = Math.atan2(uy, ux);
    const count = Math.floor(len / spacing);
    for (let k = 0; k < count; k++, globalIdx++) {
      const t = (k + 0.5) * (len / count);
      out.push({ x: a.x + ux * t, y: a.y + uy * t, yaw, nx, ny, t: globalIdx + salt });
    }
  }
  return out;
}

/* --------------------------- Procedural textures -------------------------- */

function makeTexture(
  size: number,
  repeat: [number, number],
  painter: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  painter(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function paintNoise(ctx: CanvasRenderingContext2D, size: number, base: string, specks: Array<[string, number, number]>) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (const [color, count, maxR] of specks) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const r = 0.4 + hash01(i, count) * maxR;
      ctx.globalAlpha = 0.12 + hash01(i, count + 1) * 0.25;
      ctx.beginPath();
      ctx.arc(hash01(i, count + 2) * size, hash01(i, count + 3) * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** UVs of ShapeGeometry are world metres, so repeat = 1 / tile-size-in-metres. */
function useGroundTextures() {
  return useMemo(() => {
    const asphalt = makeTexture(512, [1 / 5, 1 / 5], (ctx, s) => {
      paintNoise(ctx, s, "#3d3d3c", [["#565654", 5000, 1.4], ["#2c2c2b", 4200, 1.6], ["#6a6a67", 900, 0.9]]);
    });
    // Concrete pavers with joint lines every ~1.25 m
    const paver = makeTexture(512, [1 / 2.5, 1 / 2.5], (ctx, s) => {
      paintNoise(ctx, s, "#cfc9bb", [["#bdb7a9", 3600, 1.8], ["#dcd6c8", 2600, 1.6]]);
      ctx.strokeStyle = "#a8a294";
      ctx.lineWidth = 3;
      for (let i = 0; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo((i * s) / 2, 0); ctx.lineTo((i * s) / 2, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i * s) / 2); ctx.lineTo(s, (i * s) / 2); ctx.stroke();
      }
    });
    const sand = makeTexture(512, [220, 220], (ctx, s) => {
      paintNoise(ctx, s, "#cbc3ab", [["#bfb69c", 4200, 1.9], ["#d8d1b9", 3400, 1.7], ["#a89f86", 700, 1.1]]);
    });
    const grass = makeTexture(512, [1 / 2.4, 1 / 2.4], (ctx, s) => {
      paintNoise(ctx, s, "#5d7a3c", [["#4c672f", 5200, 1.7], ["#71914a", 4200, 1.5], ["#3c5423", 1300, 1.1]]);
    });
    // Neighbour facade: window grid on plaster (tinted per block via material color)
    const facade = makeTexture(256, [1, 1], (ctx, s) => {
      ctx.fillStyle = "#e8e2d4";
      ctx.fillRect(0, 0, s, s);
      const cols = 4, rows = 4;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = (i + 0.22) * (s / cols);
          const y = (j + 0.2) * (s / rows);
          ctx.fillStyle = hash01(i * 7 + j, 41) < 0.25 ? "#4e5c60" : "#26333a";
          ctx.fillRect(x, y, (s / cols) * 0.56, (s / rows) * 0.62);
        }
      }
    });
    return { asphalt, paver, sand, grass, facade };
  }, []);
}

/* ------------------------------- Movement -------------------------------- */

function WalkControls({ blocked }: { blocked: (x: number, z: number) => boolean }) {
  const keys = useRef<Record<string, boolean>>({});
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.code] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const k = keys.current;
    const dt = Math.min(delta, 0.05);
    const speed = (k.ShiftLeft || k.ShiftRight ? RUN_SPEED : WALK_SPEED) * dt;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);

    let mx = 0, mz = 0;
    if (k.KeyW || k.ArrowUp) { mx += fwd.x; mz += fwd.z; }
    if (k.KeyS || k.ArrowDown) { mx -= fwd.x; mz -= fwd.z; }
    if (k.KeyD || k.ArrowRight) { mx += right.x; mz += right.z; }
    if (k.KeyA || k.ArrowLeft) { mx -= right.x; mz -= right.z; }
    if (mx === 0 && mz === 0) {
      camera.position.y = EYE_H;
      return;
    }
    const len = Math.hypot(mx, mz);
    mx = (mx / len) * speed;
    mz = (mz / len) * speed;
    const px = camera.position.x, pz = camera.position.z;
    if (!blocked(px + mx, pz + mz)) {
      camera.position.x = px + mx;
      camera.position.z = pz + mz;
    } else if (!blocked(px + mx, pz)) {
      camera.position.x = px + mx;
    } else if (!blocked(px, pz + mz)) {
      camera.position.z = pz + mz;
    }
    camera.position.y = EYE_H;
  });

  return null;
}

/** Applies the HUD-controlled field of view, and — when verticals correction
 *  is on — converts the camera's pitch into a vertical lens shift: the camera
 *  stays level (so all verticals render perfectly parallel, like an
 *  architectural tilt-shift photograph) while mouse-up/down pans the shifted
 *  frustum to bring the tower top into frame. */
function CameraTuner({
  fov, verticals, pitchBank,
}: {
  fov: number;
  verticals: boolean;
  pitchBank: MutableRefObject<number>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);

  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, fov]);

  useFrame(() => {
    if (!verticals) return;
    // Harvest whatever pitch the pointer-lock controls applied since the last
    // frame into the bank, then force the camera level again.
    euler.setFromQuaternion(camera.quaternion);
    if (Math.abs(euler.x) > 1e-5) {
      pitchBank.current = THREE.MathUtils.clamp(pitchBank.current + euler.x, -1.15, 1.15);
      euler.x = 0;
      euler.z = 0;
      camera.quaternion.setFromEuler(euler);
    }
    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const yShift = (-Math.tan(pitchBank.current) / (2 * halfTan)) * size.height;
    camera.setViewOffset(size.width, size.height, 0, yShift, size.width, size.height);
  });

  useEffect(() => {
    if (verticals) return;
    // Leaving verticals mode: hand the banked pitch back to the camera so the
    // view direction doesn't jump.
    camera.clearViewOffset();
    euler.setFromQuaternion(camera.quaternion);
    euler.x = THREE.MathUtils.clamp(euler.x + pitchBank.current, -1.45, 1.45);
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
    pitchBank.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticals]);

  return null;
}

/** Exposes a render-and-capture function so the HUD can send the current
 *  frame to the AI renderer. */
function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<(() => string) | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
    return () => { captureRef.current = null; };
  }, [gl, scene, camera, captureRef]);
  return null;
}

/* ----------------------------- Vegetation -------------------------------- */

function Palm({ x, z, s, seedI }: { x: number; z: number; s: number; seedI: number }) {
  const lean = (hash01(seedI, 51) - 0.5) * 0.22;
  const leanYaw = hash01(seedI, 52) * Math.PI * 2;
  const fronds = useMemo(() => {
    const n = 11;
    return Array.from({ length: n }, (_, i) => ({
      yaw: (i / n) * Math.PI * 2 + hash01(seedI * 31 + i, 53) * 0.4,
      droop: 0.55 + hash01(seedI * 31 + i, 54) * 0.55,
      len: 2.4 + hash01(seedI * 31 + i, 55) * 0.9,
      tone: 0.85 + hash01(seedI * 31 + i, 56) * 0.35,
    }));
  }, [seedI]);
  const H = 6.2 * s;
  return (
    <group position={[x, 0, z]} rotation={[0, leanYaw, 0]}>
      <group rotation={[0, 0, lean]}>
        {/* segmented trunk with a gentle curve */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[i * 0.09 * s, (i + 0.5) * (H / 4), 0]} rotation={[0, 0, -i * 0.045]} castShadow>
            <cylinderGeometry args={[0.14 * s * (1 - i * 0.12), 0.19 * s * (1 - i * 0.1), H / 4 + 0.12, 7]} />
            <meshStandardMaterial color="#8a7355" roughness={0.95} />
          </mesh>
        ))}
        <group position={[3.4 * 0.09 * s, H, 0]}>
          {fronds.map((f, i) => (
            <group key={i} rotation={[0, f.yaw, 0]}>
              <mesh position={[f.len / 2.4, 0.28, 0]} rotation={[0, 0, -f.droop]} castShadow>
                <coneGeometry args={[0.34, f.len, 4]} />
                <meshStandardMaterial
                  color={new THREE.Color(0.16 * f.tone, 0.34 * f.tone, 0.13 * f.tone)}
                  roughness={0.85}
                  flatShading
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.1, 0]} castShadow>
            <sphereGeometry args={[0.24 * s, 8, 6]} />
            <meshStandardMaterial color="#6d5a3a" roughness={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function LeafyTree({ x, z, s, seedI }: { x: number; z: number; s: number; seedI: number }) {
  const tone = 0.8 + hash01(seedI, 61) * 0.4;
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.18, 2.6, 6]} />
        <meshStandardMaterial color="#6d5636" roughness={0.9} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[(hash01(seedI * 5 + i, 62) - 0.5) * 1.2, 3.1 + (hash01(seedI * 5 + i, 63) - 0.3) * 0.9, (hash01(seedI * 5 + i, 64) - 0.5) * 1.2]}
          castShadow
        >
          <icosahedronGeometry args={[1.15 + hash01(seedI * 5 + i, 65) * 0.5, 1]} />
          <meshStandardMaterial
            color={new THREE.Color(0.26 * tone, 0.42 * tone, 0.19 * tone)}
            roughness={0.9}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function Bush({ x, z, s, seedI }: { x: number; z: number; s: number; seedI: number }) {
  const tone = 0.75 + hash01(seedI, 71) * 0.5;
  return (
    <group position={[x, 0, z]} scale={s}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[(hash01(seedI * 3 + i, 72) - 0.5) * 0.9, 0.32 + hash01(seedI * 3 + i, 73) * 0.2, (hash01(seedI * 3 + i, 74) - 0.5) * 0.9]}
          castShadow
        >
          <icosahedronGeometry args={[0.42 + hash01(seedI * 3 + i, 75) * 0.28, 1]} />
          <meshStandardMaterial
            color={new THREE.Color(0.22 * tone, 0.4 * tone, 0.16 * tone)}
            roughness={0.95}
            flatShading
          />
        </mesh>
      ))}
    </group>
  );
}

function StreetPlanting({ ring }: { ring: Point[] }) {
  const spots = useMemo(
    () => sampleAlongPolygon(ring, 12).filter((s) => hash01(Math.round(s.t * 7), 3) > 0.2),
    [ring],
  );
  return (
    <>
      {spots.map((s, i) =>
        hash01(i, 81) < 0.62 ? (
          <Palm key={i} x={s.x} z={-s.y} s={0.8 + hash01(i, 82) * 0.45} seedI={i} />
        ) : (
          <LeafyTree key={i} x={s.x} z={-s.y} s={0.85 + hash01(i, 83) * 0.4} seedI={i} />
        ),
      )}
    </>
  );
}

function BaseLandscaping({ ring }: { ring: Point[] }) {
  const spots = useMemo(() => sampleAlongPolygon(ring, 3.4), [ring]);
  return (
    <>
      {spots.map((s, i) => {
        const r = hash01(i, 91);
        if (r < 0.55) return <Bush key={i} x={s.x} z={-s.y} s={0.8 + hash01(i, 92) * 0.7} seedI={i} />;
        if (r < 0.68) return <Palm key={i} x={s.x} z={-s.y} s={0.55 + hash01(i, 93) * 0.3} seedI={i + 500} />;
        return null;
      })}
    </>
  );
}

function StreetLamps({ ring }: { ring: Point[] }) {
  const spots = useMemo(() => sampleAlongPolygon(ring, 30), [ring]);
  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, -s.y]} rotation={[0, Math.atan2(s.ny, s.nx), 0]}>
          <mesh position={[0, 2.6, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 5.2, 8]} />
            <meshStandardMaterial color="#4d4f52" roughness={0.45} metalness={0.7} />
          </mesh>
          <mesh position={[0.85, 5.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 1.7, 6]} />
            <meshStandardMaterial color="#4d4f52" roughness={0.45} metalness={0.7} />
          </mesh>
          <mesh position={[1.7, 5.1, 0]}>
            <boxGeometry args={[0.55, 0.14, 0.22]} />
            <meshStandardMaterial color="#e8e4d4" emissive="#fff3c4" emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}
    </>
  );
}

const NEIGHBOR_TONES = ["#d8d2c2", "#cfc8b8", "#c2bcae", "#e0dacb", "#b6b0a3"];

function NeighborBlocks({
  centroid, ringRadius, facadeTex,
}: {
  centroid: Point;
  ringRadius: number;
  facadeTex: THREE.Texture;
}) {
  const blocks = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; h: number; color: string; yaw: number; tex: THREE.Texture }[] = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 + hash01(i, 31) * 0.35;
      const dist = ringRadius + 16 + hash01(i, 32) * 55;
      const w = 16 + hash01(i, 33) * 22;
      const d = 16 + hash01(i, 34) * 22;
      const h = 10 + Math.pow(hash01(i, 35), 1.6) * 52;
      const tex = facadeTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(w / 13)), Math.max(1, Math.round(h / 13)));
      out.push({
        x: centroid.x + Math.cos(angle) * dist,
        z: -centroid.y + Math.sin(angle) * dist,
        w, d, h, tex,
        color: NEIGHBOR_TONES[Math.floor(hash01(i, 36) * NEIGHBOR_TONES.length)],
        yaw: (Math.round(hash01(i, 37) * 4) * Math.PI) / 2,
      });
    }
    return out;
  }, [centroid, ringRadius, facadeTex]);
  return (
    <>
      {blocks.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.yaw, 0]}>
          <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.color} roughness={0.85} map={b.tex} />
          </mesh>
          <mesh position={[0, b.h + 0.25, 0]}>
            <boxGeometry args={[b.w * 0.94, 0.5, b.d * 0.94]} />
            <meshStandardMaterial color="#a39d8f" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/* --------------------------------- Ground -------------------------------- */

function TexturedRing({
  inner, outer, y, map, color = "#ffffff", roughness = 1,
}: {
  inner: Point[];
  outer: Point[];
  y: number;
  map: THREE.Texture;
  color?: string;
  roughness?: number;
}) {
  const shape = useMemo(() => {
    if (outer.length < 3) return null;
    const s = polyToShape(outer);
    if (!s) return null;
    if (inner.length >= 3) {
      const src = inner.slice().reverse();
      const path = new THREE.Path();
      path.moveTo(src[0].x, src[0].y);
      for (let i = 1; i < src.length; i++) path.lineTo(src[i].x, src[i].y);
      path.closePath();
      s.holes.push(path);
    }
    return s;
  }, [inner, outer]);
  if (!shape) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial map={map} color={color} roughness={roughness} />
    </mesh>
  );
}

function CentrelineDashes({ ring }: { ring: Point[] }) {
  const dashes = useMemo(() => sampleAlongPolygon(ring, 4.6), [ring]);
  return (
    <>
      {dashes.map((d, i) => (
        <mesh key={i} position={[d.x, 0.015, -d.y]} rotation={[0, d.yaw, 0]} receiveShadow>
          <boxGeometry args={[2.1, 0.012, 0.16]} />
          <meshStandardMaterial color="#e9e2cd" roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

/* --------------------------------- Scene --------------------------------- */

function WalkScene({ plot, volumes, floorHeight, facade }: Omit<WalkProps, "onExit">) {
  const facadeActive = facade.mode === "residential";
  const finsActive = facade.groundPodiumTreatment === "fins";
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);
  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const tex = useGroundTextures();

  const sidewalkOuter = useMemo(() => offsetPolygon(plot, plot.map(() => -SIDEWALK_W)), [plot]);
  const roadOuter = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W + ROAD_W))), [plot]);
  const treeRing = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W * 0.55))), [plot]);
  const lampRing = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W - 0.4))), [plot]);
  const centreline = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W + ROAD_W / 2))), [plot]);

  // The tier standing on the ground — its footprint bounds the base planting ring.
  const baseVolume = useMemo(
    () => volumes.find((v) => v.fromY <= 0.01 && v.toY > 0.5 && v.kind !== "basement"),
    [volumes],
  );
  const plantInner = baseVolume?.polygon ?? [];
  const bushRing = useMemo(
    () => (plantInner.length >= 3 ? offsetPolygon(plantInner, plantInner.map(() => -0.9)) : []),
    [plantInner],
  );

  const deckVolume = useMemo(
    () => volumes.find((v) => v.kind === "podium") ?? volumes.find((v) => v.kind === "ground"),
    [volumes],
  );
  const towerVolume = useMemo(() => volumes.find((v) => v.kind === "tower"), [volumes]);
  const amenityPlan = useMemo(
    () =>
      deckVolume && (facade.podiumPool || facade.podiumLoungeBbq)
        ? planPodiumAmenities(deckVolume.polygon, towerVolume?.polygon ?? [], {
            pool: facade.podiumPool,
            lounge: facade.podiumLoungeBbq,
          })
        : { pool: null, lounge: null },
    [deckVolume, towerVolume, facade.podiumPool, facade.podiumLoungeBbq],
  );

  const volumeShapes = useMemo(
    () =>
      volumes.map((v) => {
        const s = polyToShape(v.polygon);
        if (s && v.hole && v.hole.length >= 3) {
          const src = v.hole.slice().reverse();
          const path = new THREE.Path();
          path.moveTo(src[0].x, src[0].y);
          for (let i = 1; i < src.length; i++) path.lineTo(src[i].x, src[i].y);
          path.closePath();
          s.holes.push(path);
        }
        return s;
      }),
    [volumes],
  );

  const collisionPolys = useMemo(
    () =>
      volumes
        .filter((v) => v.fromY <= EYE_H && v.toY > 0.4 && v.polygon.length >= 3)
        .map((v) => offsetPolygon(v.polygon, v.polygon.map(() => -0.45))),
    [volumes],
  );
  const blocked = useMemo(() => {
    return (x: number, z: number) => {
      const local = { x, y: -z };
      for (const poly of collisionPolys) {
        if (poly.length >= 3 && pointInPoly(local, poly)) return true;
      }
      return false;
    };
  }, [collisionPolys]);

  const ringRadius = Math.max(bbox.w, bbox.h) / 2 + SIDEWALK_W + ROAD_W;
  const maxDim = Math.max(bbox.w, bbox.h, 40);

  return (
    <>
      <Sky distance={450000} sunPosition={[70, 42, -35]} turbidity={4.5} rayleigh={1.9} mieCoefficient={0.005} mieDirectionalG={0.86} />
      <fog attach="fog" args={["#dfe3e6", 220, 950]} />

      {/* Local light-former environment: sky bounce + sun disc for reflections. No network fetches. */}
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={0.9} rotation-x={Math.PI / 2} position={[0, 60, 0]} scale={[200, 200, 1]} color="#dfeaf5" />
        <Lightformer intensity={2.2} form="circle" position={[70, 45, -35]} scale={[35, 35, 1]} color="#fff2da" target={[0, 0, 0]} />
        <Lightformer intensity={0.35} rotation-y={Math.PI / 2} position={[-80, 12, 0]} scale={[120, 30, 1]} color="#e7dfcc" />
        <Lightformer intensity={0.35} rotation-y={-Math.PI / 2} position={[80, 12, 0]} scale={[120, 30, 1]} color="#e7dfcc" />
      </Environment>

      <hemisphereLight args={["#e8eef4", "#c9c2ae", 0.4]} />
      <ambientLight intensity={0.18} />
      <directionalLight
        position={[centroid.x + 70, 85, -centroid.y - 45]}
        intensity={2.1}
        color="#ffefd6"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.02}
        shadow-radius={6}
        shadow-camera-left={-maxDim * 1.7}
        shadow-camera-right={maxDim * 1.7}
        shadow-camera-top={maxDim * 1.7}
        shadow-camera-bottom={-maxDim * 1.7}
      />

      {/* Ground: sand base, asphalt road, concrete pavers, planting bed at the building base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centroid.x, -0.03, -centroid.y]} receiveShadow>
        <planeGeometry args={[1400, 1400]} />
        <meshStandardMaterial map={tex.sand} roughness={1} />
      </mesh>
      <TexturedRing inner={sidewalkOuter} outer={roadOuter} y={0.0} map={tex.asphalt} roughness={0.95} />
      {centreline.length >= 3 && <CentrelineDashes ring={centreline} />}
      <TexturedRing inner={plot} outer={sidewalkOuter} y={0.02} map={tex.paver} roughness={0.9} />
      {plantInner.length >= 3 ? (
        <>
          <TexturedRing inner={plantInner} outer={plot} y={0.03} map={tex.grass} roughness={1} />
          <BaseLandscaping ring={bushRing} />
        </>
      ) : (
        <TexturedRing inner={[]} outer={plot} y={0.03} map={tex.paver} roughness={0.9} />
      )}

      {/* The project building — same treatments as the studio viewer */}
      {volumes.map((v, i) => {
        const shape = volumeShapes[i];
        const depth = v.toY - v.fromY;
        if (!shape || depth <= 0 || v.kind === "basement") return null;
        if (facadeActive && v.kind === "tower") {
          return (
            <ResidentialFacade
              key={`fac-${i}`}
              polygon={v.polygon}
              hole={v.hole}
              fromY={v.fromY}
              toY={v.toY}
              floorHeight={floorHeight}
              params={facade}
            />
          );
        }
        const colours = colourForKind(v.kind);
        const showFins = finsActive && (v.kind === "ground" || v.kind === "podium");
        return (
          <group key={i}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, v.fromY, 0]} castShadow receiveShadow>
              <extrudeGeometry args={[shape, { depth, bevelEnabled: false }]} />
              <meshPhysicalMaterial
                color={colours.fill}
                roughness={colours.roughness}
                metalness={0.05}
                clearcoat={v.kind === "tower" ? 0.25 : 0}
                clearcoatRoughness={0.7}
              />
              <Edges color={colours.edge} threshold={30} />
            </mesh>
            {showFins && <VerticalFinScreen polygon={v.polygon} fromY={v.fromY} toY={v.toY} params={facade} />}
          </group>
        );
      })}
      {deckVolume && (
        <PodiumAmenities pool={amenityPlan.pool} lounge={amenityPlan.lounge} toY={deckVolume.toY} />
      )}

      {/* Streetscape */}
      <StreetPlanting ring={treeRing} />
      <StreetLamps ring={lampRing} />
      <NeighborBlocks centroid={centroid} ringRadius={ringRadius} facadeTex={tex.facade} />

      <WalkControls blocked={blocked} />

      <EffectComposer multisampling={4}>
        <N8AO aoRadius={2.2} intensity={2.6} distanceFalloff={1} quality="performance" />
        <Bloom mipmapBlur intensity={0.22} luminanceThreshold={1.05} />
        <Vignette offset={0.28} darkness={0.5} />
      </EffectComposer>
    </>
  );
}

/* ------------------------------ Entry point ------------------------------- */

export default function MassingWalk(props: WalkProps) {
  const { plot, geometryFacts, onExit } = props;
  const [locked, setLocked] = useState(false);
  const controlsRef = useRef<PointerLockControlsImpl | null>(null);
  const captureRef = useRef<(() => string) | null>(null);

  const [fov, setFov] = useState(68);
  const [verticals, setVerticals] = useState(false);
  const pitchBank = useRef(0);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ img: string; note?: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiOpen = aiBusy || !!aiResult || !!aiError;

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);
  const start: [number, number, number] = [
    centroid.x,
    EYE_H,
    -(bbox.minY - (SIDEWALK_W + ROAD_W + 5)),
  ];

  const handleRender = useCallback(async () => {
    if (aiBusy) return;
    // Capture BEFORE releasing pointer lock so the framing is exactly what the
    // user is looking at.
    const png = captureRef.current?.();
    document.exitPointerLock?.();
    if (!png) {
      setAiError("Could not capture the view.");
      return;
    }
    const key = typeof window !== "undefined" ? (window.localStorage.getItem("qube.gemini.apiKey") ?? "") : "";
    if (!key) {
      setAiError("No Gemini API key set. Configure it in the Massing tab → AI render panel first (it's stored in this browser and shared with this mode).");
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiResult(null);
    try {
      const prompt = `${geometryFacts ? `${geometryFacts}\n\n` : ""}${DEFAULT_WALK_HYPERREAL_PROMPT}`;
      const out = await renderSchemeWithGemini(key, png, prompt);
      setAiResult({ img: out.imageDataUrl, note: out.textNote });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, geometryFacts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.pointerLockElement && !aiOpen) onExit();
      if (e.code === "KeyV" && document.pointerLockElement) setVerticals((v) => !v);
      if (e.code === "KeyR" && document.pointerLockElement && !aiOpen) void handleRender();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, aiOpen, handleRender]);

  // Mouse wheel = lens zoom (works while pointer-locked). Wider FOV lets the
  // whole tower fit in frame from the sidewalk.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!document.pointerLockElement) return;
      setFov((f) => THREE.MathUtils.clamp(f + (e.deltaY > 0 ? 3 : -3), 28, 105));
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  function downloadAiResult() {
    if (!aiResult) return;
    const a = document.createElement("a");
    a.href = aiResult.img;
    a.download = "immersive-hyperreal.png";
    a.click();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <Canvas
        shadows
        camera={{ position: start, fov: 68, near: 0.15, far: 1600 }}
        gl={{ antialias: false }}
        dpr={[1, 1.5]}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
        }}
      >
        <WalkScene {...props} />
        <CameraTuner fov={fov} verticals={verticals} pitchBank={pitchBank} />
        <CaptureBridge captureRef={captureRef} />
        <PointerLockControls
          ref={controlsRef}
          onLock={() => setLocked(true)}
          onUnlock={() => setLocked(false)}
        />
      </Canvas>

      {locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/70 shadow" />
      )}

      {locked && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/55 text-white/85 text-[12px] tracking-wide rounded-sm text-center leading-relaxed">
          WASD move · mouse look · Shift run · ESC pause
          <br />
          <span className="text-white/65">
            wheel FOV ({fov}°) · V verticals {verticals ? "ON" : "off"} · R hyperreal render
          </span>
        </div>
      )}

      {locked && verticals && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/55 text-white/80 text-[11px] uppercase tracking-[0.14em] rounded-sm">
          ⊥ Verticals corrected
        </div>
      )}

      {!locked && !aiOpen && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-center text-bone-100 max-w-[460px] px-8">
            <div className="text-[11px] uppercase tracking-[0.3em] text-bone-200/60 mb-2">Immersive walk</div>
            <h2 className="text-2xl font-light mb-4">Virtual walk</h2>
            <p className="text-[13px] text-bone-200/80 leading-relaxed mb-6">
              <strong>WASD</strong> to move · <strong>mouse</strong> to look · <strong>Shift</strong> to run
              <br />
              <strong>wheel</strong> zoom (FOV) · <strong>V</strong> corrected verticals ·{" "}
              <strong>R</strong> hyperreal render · <strong>ESC</strong> to pause
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => controlsRef.current?.lock()}
                className="px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
              >
                ▶ Enter
              </button>
              <button
                onClick={() => void handleRender()}
                className="px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] border border-qube-400/60 text-qube-200 hover:bg-qube-500/20 transition-colors"
                title="Send the current view to Gemini as a hyperreal archviz render"
              >
                ✦ Hyperreal render
              </button>
              <button
                onClick={onExit}
                className="px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] border border-bone-100/30 text-bone-100 hover:bg-white/10 transition-colors"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI render overlay: spinner → result / error */}
      {aiOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6">
          {aiBusy ? (
            <div className="text-center text-bone-100">
              <div className="mx-auto w-10 h-10 border-2 border-qube-400 border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-[12px] uppercase tracking-[0.2em] text-bone-200/70">
                Rendering with Gemini…
              </div>
            </div>
          ) : aiError ? (
            <div className="max-w-[520px] text-center text-bone-100">
              <div className="text-[11px] uppercase tracking-[0.3em] text-red-300/80 mb-3">Render failed</div>
              <p className="text-[13px] text-bone-200/85 leading-relaxed whitespace-pre-wrap mb-6">{aiError}</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => void handleRender()}
                  className="px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
                >↻ Retry</button>
                <button
                  onClick={() => setAiError(null)}
                  className="px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] border border-bone-100/30 text-bone-100 hover:bg-white/10 transition-colors"
                >Close</button>
              </div>
            </div>
          ) : aiResult ? (
            <div className="max-w-[1100px] w-full max-h-full flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={aiResult.img}
                alt="Hyperreal AI render of the current view"
                className="w-full h-auto max-h-[80vh] object-contain border border-white/15"
              />
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={downloadAiResult}
                  className="px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] border border-bone-100/30 text-bone-100 hover:bg-white/10 transition-colors"
                >↓ Download PNG</button>
                <button
                  onClick={() => void handleRender()}
                  className="px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] border border-qube-400/60 text-qube-200 hover:bg-qube-500/20 transition-colors"
                >↻ Re-render</button>
                <button
                  onClick={() => setAiResult(null)}
                  className="px-5 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
                >Close</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
