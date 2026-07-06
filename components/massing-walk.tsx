"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Sky, Edges } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import type { Point } from "@/lib/geom";
import { isCounterClockwise, offsetPolygon, polygonBBox, polygonCentroid } from "@/lib/geom";
import type { Volume } from "@/lib/massing";
import { planPodiumAmenities } from "@/lib/podium-amenities";
import {
  GroundRing,
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

/** Sample points along a polygon's edges at roughly the given spacing.
 *  Returns position + the edge's yaw + outward normal. */
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
    // Try full move, then axis-by-axis so you slide along walls instead of sticking.
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

/* ----------------------------- Street dressing ---------------------------- */

function Trees({ ring }: { ring: Point[] }) {
  const spots = useMemo(
    () => sampleAlongPolygon(ring, 13).filter((s) => hash01(Math.round(s.t * 7), 3) > 0.25),
    [ring],
  );
  return (
    <>
      {spots.map((s, i) => {
        const scale = 0.85 + hash01(i, 11) * 0.5;
        const canopyTone = 0.85 + hash01(i, 12) * 0.3;
        return (
          <group key={i} position={[s.x, 0, -s.y]} scale={scale}>
            <mesh position={[0, 1.3, 0]} castShadow>
              <cylinderGeometry args={[0.13, 0.18, 2.6, 6]} />
              <meshStandardMaterial color="#6d5636" roughness={0.9} />
            </mesh>
            <mesh position={[0, 3.4, 0]} castShadow>
              <icosahedronGeometry args={[1.7, 1]} />
              <meshStandardMaterial
                color={new THREE.Color(0.28 * canopyTone, 0.42 * canopyTone, 0.2 * canopyTone)}
                roughness={0.85}
                flatShading
              />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function StreetLamps({ ring }: { ring: Point[] }) {
  const spots = useMemo(() => sampleAlongPolygon(ring, 26), [ring]);
  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, -s.y]} rotation={[0, Math.atan2(s.ny, s.nx), 0]}>
          <mesh position={[0, 2.6, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 5.2, 8]} />
            <meshStandardMaterial color="#4d4f52" roughness={0.5} metalness={0.6} />
          </mesh>
          {/* arm reaching over the road (local +X after the yaw above = outward) */}
          <mesh position={[0.85, 5.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 1.7, 6]} />
            <meshStandardMaterial color="#4d4f52" roughness={0.5} metalness={0.6} />
          </mesh>
          <mesh position={[1.7, 5.1, 0]}>
            <boxGeometry args={[0.55, 0.14, 0.22]} />
            <meshStandardMaterial color="#e8e4d4" emissive="#fff3c4" emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </>
  );
}

const CAR_COLORS = ["#e8e6e1", "#c9c9cc", "#2c2e33", "#7c1f24", "#b8a888", "#39506b", "#5b5e63"];

function ParkedCars({ ring }: { ring: Point[] }) {
  const cars = useMemo(
    () =>
      sampleAlongPolygon(ring, 8.5)
        .filter((s, i) => hash01(i, 21) < 0.55)
        .map((s, i) => ({
          ...s,
          color: CAR_COLORS[Math.floor(hash01(i, 22) * CAR_COLORS.length)],
          flip: hash01(i, 23) > 0.5 ? Math.PI : 0,
        })),
    [ring],
  );
  return (
    <>
      {cars.map((c, i) => (
        <group key={i} position={[c.x, 0, -c.y]} rotation={[0, c.yaw + c.flip, 0]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[4.35, 0.62, 1.82]} />
            <meshStandardMaterial color={c.color} roughness={0.35} metalness={0.55} />
          </mesh>
          <mesh position={[-0.25, 1.12, 0]} castShadow>
            <boxGeometry args={[2.25, 0.55, 1.66]} />
            <meshStandardMaterial color="#1a2126" roughness={0.15} metalness={0.6} />
          </mesh>
          {[[-1.4, 0.78], [1.4, 0.78], [-1.4, -0.78], [1.4, -0.78]].map(([wx, wz], w) => (
            <mesh key={w} position={[wx, 0.33, wz]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.33, 0.33, 0.26, 12]} />
              <meshStandardMaterial color="#17181a" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

const NEIGHBOR_TONES = ["#d8d2c2", "#cfc8b8", "#c2bcae", "#e0dacb", "#b6b0a3"];

function NeighborBlocks({ centroid, ringRadius }: { centroid: Point; ringRadius: number }) {
  const blocks = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; h: number; color: string; yaw: number }[] = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2 + hash01(i, 31) * 0.35;
      const dist = ringRadius + 16 + hash01(i, 32) * 55;
      const w = 14 + hash01(i, 33) * 20;
      const d = 14 + hash01(i, 34) * 20;
      const h = 8 + Math.pow(hash01(i, 35), 1.6) * 52;
      out.push({
        x: centroid.x + Math.cos(angle) * dist,
        z: -centroid.y + Math.sin(angle) * dist,
        w, d, h,
        color: NEIGHBOR_TONES[Math.floor(hash01(i, 36) * NEIGHBOR_TONES.length)],
        yaw: (Math.round(hash01(i, 37) * 4) * Math.PI) / 2,
      });
    }
    return out;
  }, [centroid, ringRadius]);
  return (
    <>
      {blocks.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.yaw, 0]}>
          <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.color} roughness={0.85} />
            <Edges color="#8f8a7d" threshold={20} />
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

/* --------------------------------- Scene --------------------------------- */

function WalkScene({ plot, volumes, floorHeight, facade }: Omit<WalkProps, "onExit">) {
  const facadeActive = facade.mode === "residential";
  const finsActive = facade.groundPodiumTreatment === "fins";
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);
  const bbox = useMemo(() => polygonBBox(plot), [plot]);

  const sidewalkOuter = useMemo(() => offsetPolygon(plot, plot.map(() => -SIDEWALK_W)), [plot]);
  const roadOuter = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W + ROAD_W))), [plot]);
  const treeRing = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W * 0.55))), [plot]);
  const lampRing = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W - 0.4))), [plot]);
  const parkRing = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W + 2.1))), [plot]);
  const centreline = useMemo(() => offsetPolygon(plot, plot.map(() => -(SIDEWALK_W + ROAD_W / 2))), [plot]);

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

  // Collision: block walking through any volume that occupies eye height,
  // padded outward by half a shoulder width.
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
  const plotShape = useMemo(() => polyToShape(plot), [plot]);
  const maxDim = Math.max(bbox.w, bbox.h, 40);

  return (
    <>
      <Sky distance={450000} sunPosition={[70, 48, -35]} turbidity={5.5} rayleigh={2.2} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#dfe3e6", 180, 850]} />
      <hemisphereLight args={["#e8eef4", "#c9c2ae", 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[centroid.x + 70, 90, -centroid.y - 45]}
        intensity={1.6}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-camera-left={-maxDim * 1.6}
        shadow-camera-right={maxDim * 1.6}
        shadow-camera-top={maxDim * 1.6}
        shadow-camera-bottom={-maxDim * 1.6}
      />

      {/* Ground: desert-sand base, then road / sidewalk / plot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centroid.x, -0.03, -centroid.y]} receiveShadow>
        <planeGeometry args={[1400, 1400]} />
        <meshStandardMaterial color="#cec7b2" roughness={1} />
      </mesh>
      <GroundRing inner={sidewalkOuter} outer={roadOuter} y={0.0} color="#4e4d4a" roughness={1} />
      {centreline.length >= 3 && (
        <CentrelineDashes ring={centreline} />
      )}
      <GroundRing inner={plot} outer={sidewalkOuter} y={0.02} color="#d5d0c3" roughness={0.95} />
      {plotShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <shapeGeometry args={[plotShape]} />
          <meshStandardMaterial color="#e6e1d3" roughness={0.95} />
        </mesh>
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
      <Trees ring={treeRing} />
      <StreetLamps ring={lampRing} />
      <ParkedCars ring={parkRing} />
      <NeighborBlocks centroid={centroid} ringRadius={ringRadius} />

      <WalkControls blocked={blocked} />
    </>
  );
}

/** Dashed centreline drawn as short instanced boxes lying on the asphalt —
 *  reads better at street level than a screen-space dashed line. */
function CentrelineDashes({ ring }: { ring: Point[] }) {
  const dashes = useMemo(() => sampleAlongPolygon(ring, 4.6), [ring]);
  return (
    <>
      {dashes.map((d, i) => (
        <mesh key={i} position={[d.x, 0.012, -d.y]} rotation={[0, d.yaw, 0]} receiveShadow>
          <boxGeometry args={[2.1, 0.012, 0.16]} />
          <meshStandardMaterial color="#efe9d6" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

/* ------------------------------ Entry point ------------------------------- */

export default function MassingWalk(props: WalkProps) {
  const { plot, onExit } = props;
  const [locked, setLocked] = useState(false);
  const controlsRef = useRef<PointerLockControlsImpl | null>(null);

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);
  // Start on the far sidewalk across the street from the plot's front edge.
  const start: [number, number, number] = [
    centroid.x,
    EYE_H,
    -(bbox.minY - (SIDEWALK_W + ROAD_W + 5)),
  ];

  // Escape hatch: Esc releases pointer lock (browser behaviour); a second
  // Esc — or the Exit button — leaves immersive mode entirely.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.pointerLockElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <Canvas
        shadows
        camera={{ position: start, fov: 72, near: 0.15, far: 1600 }}
        gl={{ antialias: true }}
        dpr={[1, 1.75]}
      >
        <WalkScene {...props} />
        <PointerLockControls
          ref={controlsRef}
          onLock={() => setLocked(true)}
          onUnlock={() => setLocked(false)}
        />
      </Canvas>

      {/* Crosshair */}
      {locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/70 shadow" />
      )}

      {/* HUD hint */}
      {locked && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/55 text-white/85 text-[12px] tracking-wide rounded-sm">
          WASD moverse · ratón mirar · Shift correr · ESC pausa
        </div>
      )}

      {/* Splash / pause overlay */}
      {!locked && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="text-center text-bone-100 max-w-[420px] px-8">
            <div className="text-[11px] uppercase tracking-[0.3em] text-bone-200/60 mb-2">Immersive walk</div>
            <h2 className="text-2xl font-light mb-4">Paseo virtual</h2>
            <p className="text-[13px] text-bone-200/80 leading-relaxed mb-6">
              <strong>WASD</strong> para moverte · <strong>ratón</strong> para mirar ·{" "}
              <strong>Shift</strong> para correr · <strong>ESC</strong> para pausar
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => controlsRef.current?.lock()}
                className="px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
              >
                ▶ Entrar
              </button>
              <button
                onClick={onExit}
                className="px-6 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] border border-bone-100/30 text-bone-100 hover:bg-white/10 transition-colors"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
