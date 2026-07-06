"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, Line, ContactShadows, Html } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Point } from "@/lib/geom";
import { isCounterClockwise, offsetPolygon, polygonBBox, polygonCentroid } from "@/lib/geom";
import type { Volume } from "@/lib/massing";
import { planPodiumAmenities, type PlacedAmenity } from "@/lib/podium-amenities";

export type ViewPresetKind = "iso" | "front" | "top";

/** Resolved parameters for the modelled residential facade. */
export interface FacadeParams {
  mode: "massing" | "residential";
  panelWidthM: number;
  balconyDepthM: number;
  balconyEveryNBays: number;
  /** Fraction (0–1) of facade cells that get a solid precast panel instead of glazing. */
  solidPanelRatio: number;
  /** "rhythm" = balconies stack in columns on every Nth bay; "random" = scattered per cell with 1/N probability. */
  balconyLayout: "rhythm" | "random";
  /** Seed for the deterministic random pattern. */
  patternSeed: number;
  /** Treatment for the Ground + Podium tiers; "fins" adds a vertical louvre screen in front of the solid volume. */
  groundPodiumTreatment: "massing" | "fins";
  finSpacingM: number;
  finWidthM: number;
  finDepthM: number;
  /** Model a swimming pool on the podium roof deck, only if it fits. */
  podiumPool: boolean;
  /** Model a lounge + BBQ terrace on the podium roof deck, only if it fits. */
  podiumLoungeBbq: boolean;
}

/** Deterministic per-cell hash → [0,1). Stable across renders for a given seed. */
function cellRand(seed: number, i: number, j: number, salt = 0): number {
  let h = (seed | 0) ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface SceneProps {
  plot: Point[];           // Plot polygon in plot-local metres
  buildable: Point[];      // Buildable polygon (after setbacks)
  /** Volumes that compose the building. Each has its own footprint, height span and optional hole. */
  volumes: Volume[];
  /** Used to draw faint floor-level rings on the primary footprint. */
  floorHeight: number;
  /** Footprint to trace floor lines on (typically the tallest volume's polygon). */
  primaryFootprint?: Point[];
  showFrontMarker?: boolean;
  /** Optional per-edge colors for the plot outline. */
  edgeColors?: string[];
  /** Labels aligned by index with `volumes`, shown as floating chips beside each tier. */
  volumeLabels?: string[];
  /** Show dimension line + tier labels. */
  showAnnotations?: boolean;
  /** Camera preset request; bump `nonce` to re-trigger the same preset. */
  viewPreset?: { kind: ViewPresetKind; nonce: number } | null;
  /** Slow turntable rotation. */
  autoRotate?: boolean;
  /** Receives a function that renders a frame and returns it as a PNG data-URL. */
  captureRef?: MutableRefObject<(() => string) | null>;
  /** Facade treatment; "residential" models slabs, glazing, mullions and balconies on the tower. */
  facade?: FacadeParams;
  /** Reports whether the requested podium amenities actually found room, so the tab can show a hint. */
  onAmenityFit?: (fit: { pool: boolean; lounge: boolean }) => void;
}

interface CameraGoal {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
}

export default function MassingScene(props: SceneProps) {
  const {
    plot, buildable, volumes, floorHeight, showFrontMarker, edgeColors,
    volumeLabels, showAnnotations = true, viewPreset, autoRotate, captureRef,
    facade, onAmenityFit,
  } = props;
  const facadeActive = facade?.mode === "residential";
  const finsActive = facade?.groundPodiumTreatment === "fins";

  const podiumVolume = useMemo(() => volumes.find((v) => v.kind === "podium"), [volumes]);
  const towerVolume = useMemo(() => volumes.find((v) => v.kind === "tower"), [volumes]);
  const wantPool = !!facade?.podiumPool;
  const wantLounge = !!facade?.podiumLoungeBbq;
  const amenityPlan = useMemo(
    () =>
      podiumVolume && (wantPool || wantLounge)
        ? planPodiumAmenities(podiumVolume.polygon, towerVolume?.polygon ?? [], { pool: wantPool, lounge: wantLounge })
        : { pool: null, lounge: null },
    [podiumVolume, towerVolume, wantPool, wantLounge],
  );
  useEffect(() => {
    onAmenityFit?.({
      pool: wantPool ? amenityPlan.pool !== null : true,
      lounge: wantLounge ? amenityPlan.lounge !== null : true,
    });
  }, [amenityPlan, wantPool, wantLounge, onAmenityFit]);

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);

  const topY = volumes.reduce((m, v) => Math.max(m, v.toY), 0);
  const maxDim = Math.max(bbox.w, bbox.h, topY, 30);
  const camDist = maxDim * 1.4;

  const plotShape = useMemo(() => polyToShape(plot), [plot]);
  const buildableShape = useMemo(() => (buildable.length >= 3 ? polyToShape(buildable) : null), [buildable]);

  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const goalRef = useRef<CameraGoal | null>(null);

  const volumeShapes = useMemo(
    () =>
      volumes.map((v) => {
        const s = polyToShape(v.polygon);
        if (s && v.hole && v.hole.length >= 3) {
          const reversed = v.hole.slice().reverse(); // holes need opposite winding
          const path = new THREE.Path();
          path.moveTo(reversed[0].x, reversed[0].y);
          for (let i = 1; i < reversed.length; i++) path.lineTo(reversed[i].x, reversed[i].y);
          path.closePath();
          s.holes.push(path);
        }
        return s;
      }),
    [volumes]
  );

  const floorRings = useMemo(() => {
    if (floorHeight <= 0 || volumes.length === 0) return [];
    const out: { y: number; polygon: Point[]; hole?: Point[]; emphasis: boolean; kind?: Volume["kind"] }[] = [];
    for (const v of volumes) {
      // Floor levels inside this volume, excluding top and bottom (those are mesh edges)
      const startFloor = Math.floor(v.fromY / floorHeight) + 1;
      const endFloor = Math.ceil(v.toY / floorHeight) - 1;
      for (let f = startFloor; f <= endFloor; f++) {
        const y = f * floorHeight;
        if (y <= v.fromY + 1e-3 || y >= v.toY - 1e-3) continue;
        out.push({ y, polygon: v.polygon, hole: v.hole, emphasis: f % 5 === 0, kind: v.kind });
      }
    }
    return out;
  }, [volumes, floorHeight]);

  // Annotation anchors: dimension line on the right of the plot, tier chips on the left.
  const annotPad = Math.max(2.5, maxDim * 0.08);
  const dimX = bbox.maxX + annotPad;
  const labelX = bbox.minX - annotPad;
  const tierBoundaries = useMemo(() => {
    const ys = new Set<number>([0]);
    volumes.forEach((v) => {
      if (v.fromY >= 0) ys.add(v.fromY);
      if (v.toY > 0) ys.add(v.toY);
    });
    return Array.from(ys).sort((a, b) => a - b);
  }, [volumes]);

  return (
    <Canvas
      shadows
      camera={{
        position: [centroid.x + camDist * 0.85, camDist * 0.7, -centroid.y + camDist],
        fov: 40,
        near: 0.5,
        far: maxDim * 12,
      }}
      gl={{ alpha: true, antialias: true }}
      style={{
        background:
          "radial-gradient(120% 90% at 50% 0%, #f4f5ef 0%, #f6f4ee 45%, #eceadf 100%)",
      }}
      dpr={[1, 2]}
    >
      <fog attach="fog" args={["#f0eee6", camDist * 1.6, camDist * 5.5]} />

      {/* Lighting rig: warm key with shadows, cool fill, soft sky bounce */}
      <hemisphereLight args={["#f7f5ec", "#cfcaba", 0.5]} />
      <ambientLight intensity={0.32} />
      <directionalLight
        position={[centroid.x + maxDim * 0.7, maxDim * 1.5, -centroid.y + maxDim * 0.45]}
        intensity={1.25}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-maxDim}
        shadow-camera-right={maxDim}
        shadow-camera-top={maxDim}
        shadow-camera-bottom={-maxDim}
      />
      <directionalLight
        position={[centroid.x - maxDim * 0.8, maxDim * 0.6, -centroid.y - maxDim * 0.6]}
        intensity={0.35}
        color="#e3e9f2"
      />

      <Grid
        args={[maxDim * 4, maxDim * 4]}
        cellSize={1}
        cellThickness={0.3}
        cellColor="#e2dfd5"
        sectionSize={10}
        sectionThickness={0.7}
        sectionColor="#c6c2b4"
        fadeDistance={maxDim * 3}
        fadeStrength={1.6}
        position={[centroid.x, -0.001, -centroid.y]}
        infiniteGrid
      />

      {plotShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <shapeGeometry args={[plotShape]} />
          <meshStandardMaterial color="#ede9df" roughness={0.95} />
        </mesh>
      )}

      {buildableShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
          <shapeGeometry args={[buildableShape]} />
          <meshStandardMaterial color="#bccab0" opacity={0.9} transparent roughness={0.9} />
        </mesh>
      )}

      {/* Soft ambient-occlusion style grounding under the building */}
      <ContactShadows
        position={[centroid.x, 0.018, -centroid.y]}
        scale={maxDim * 2.6}
        far={Math.max(12, topY * 0.6)}
        blur={2.4}
        opacity={0.3}
        resolution={1024}
        color="#2a3020"
      />

      {/* Plot outline */}
      {edgeColors && edgeColors.length === plot.length ? (
        plot.map((p, i) => {
          const next = plot[(i + 1) % plot.length];
          const points: [number, number, number][] = [[p.x, 0.02, -p.y], [next.x, 0.02, -next.y]];
          return <Line key={`edge-${i}`} points={points} color={edgeColors[i]} lineWidth={3} />;
        })
      ) : (
        <Line points={closedPoints(plot, 0.02)} color="#3f5135" lineWidth={1.6} />
      )}

      {/* Volumes */}
      {volumes.map((v, i) => {
        const shape = volumeShapes[i];
        const depth = v.toY - v.fromY;
        if (!shape || depth <= 0) return null;
        if (facadeActive && facade && v.kind === "tower") {
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
        const showFins = finsActive && facade && (v.kind === "ground" || v.kind === "podium");
        return (
          <group key={i}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, v.fromY, 0]}
              castShadow
              receiveShadow
            >
              <extrudeGeometry args={[shape, { depth, bevelEnabled: false }]} />
              <meshPhysicalMaterial
                color={colours.fill}
                roughness={colours.roughness}
                metalness={0.05}
                clearcoat={v.kind === "tower" ? 0.25 : 0}
                clearcoatRoughness={0.7}
                transparent={colours.opacity < 1}
                opacity={colours.opacity}
              />
              <Edges color={colours.edge} threshold={1} />
            </mesh>
            {showFins && (
              <VerticalFinScreen polygon={v.polygon} fromY={v.fromY} toY={v.toY} params={facade!} />
            )}
          </group>
        );
      })}

      {/* Podium roof amenities: pool and/or lounge + BBQ terrace, on the ring
          of podium deck left exposed once the (further set back) tower rises above it. */}
      {podiumVolume && (
        <PodiumAmenities pool={amenityPlan.pool} lounge={amenityPlan.lounge} toY={podiumVolume.toY} />
      )}

      {/* Floor-level rings around each volume — emphasised every 5 floors.
          The modelled facade draws real slabs on the tower, so its rings are skipped. */}
      {floorRings
        .filter((r) => !(facadeActive && r.kind === "tower"))
        .map((r, i) => (
          <FloorRing key={`fr-${i}`} y={r.y} polygon={r.polygon} hole={r.hole} emphasis={r.emphasis} />
        ))}

      {/* Annotations: height dimension line + tier chips */}
      {showAnnotations && topY > 0 && (
        <HeightDimension x={dimX} z={-centroid.y} topY={topY} boundaries={tierBoundaries} maxDim={maxDim} />
      )}
      {showAnnotations && volumeLabels && volumeLabels.length === volumes.length &&
        volumes.map((v, i) => {
          const label = volumeLabels[i];
          if (!label) return null;
          const midY = (v.fromY + v.toY) / 2;
          return (
            <Html
              key={`vl-${i}`}
              position={[labelX, midY, -centroid.y]}
              center
              zIndexRange={[10, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div className="px-1.5 py-0.5 bg-white/90 border border-[#dcd8d0] text-[9px] font-medium uppercase tracking-[0.14em] text-[#2a2a2a] whitespace-nowrap shadow-sm">
                {label}
              </div>
            </Html>
          );
        })}

      {showFrontMarker && <FrontMarker plot={plot} />}

      <CameraRig
        preset={viewPreset ?? null}
        goalRef={goalRef}
        controlsRef={controlsRef}
        centroid={centroid}
        topY={topY}
        camDist={camDist}
      />
      {captureRef && <CaptureBridge captureRef={captureRef} />}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        enableZoom
        enableRotate
        enableDamping
        dampingFactor={0.08}
        autoRotate={!!autoRotate}
        autoRotateSpeed={0.8}
        onStart={() => { goalRef.current = null; }}
        target={[centroid.x, topY / 3, -centroid.y]}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={5}
        maxDistance={maxDim * 5}
      />
    </Canvas>
  );
}

/** Smoothly flies the camera to a requested preset; user interaction cancels the flight. */
function CameraRig({
  preset, goalRef, controlsRef, centroid, topY, camDist,
}: {
  preset: { kind: ViewPresetKind; nonce: number } | null;
  goalRef: MutableRefObject<CameraGoal | null>;
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  centroid: Point;
  topY: number;
  camDist: number;
}) {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    if (!preset) return;
    const tgt = new THREE.Vector3(centroid.x, topY / 3, -centroid.y);
    let pos: THREE.Vector3;
    if (preset.kind === "top") {
      // Slight z offset keeps OrbitControls away from the polar singularity.
      pos = new THREE.Vector3(centroid.x, camDist * 1.5, -centroid.y + camDist * 0.02);
      tgt.setY(0);
    } else if (preset.kind === "front") {
      pos = new THREE.Vector3(centroid.x, Math.max(topY * 0.45, camDist * 0.12), -centroid.y + camDist * 1.2);
    } else {
      pos = new THREE.Vector3(centroid.x + camDist * 0.85, camDist * 0.7, -centroid.y + camDist);
    }
    goalRef.current = { pos, tgt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce, preset?.kind]);

  useFrame((_, delta) => {
    const g = goalRef.current;
    const controls = controlsRef.current;
    if (!g || !controls) return;
    // Time-based damping so the flight speed is framerate-independent.
    const k = 1 - Math.exp(-5.5 * Math.min(delta, 0.1));
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.tgt, k);
    if (camera.position.distanceTo(g.pos) < 0.1) {
      camera.position.copy(g.pos);
      controls.target.copy(g.tgt);
      goalRef.current = null;
    }
    controls.update();
  });

  return null;
}

/** Exposes a render-and-capture function so the tab can offer a PNG download. */
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

function HeightDimension({
  x, z, topY, boundaries, maxDim,
}: {
  x: number;
  z: number;
  topY: number;
  boundaries: number[];
  maxDim: number;
}) {
  const tick = Math.max(0.6, maxDim * 0.015);
  const color = "#8a8a8a";
  return (
    <>
      <Line points={[[x, 0, z], [x, topY, z]]} color={color} lineWidth={1} />
      {boundaries.map((y, i) => (
        <Line key={`tick-${i}`} points={[[x - tick, y, z], [x + tick, y, z]]} color={color} lineWidth={1} />
      ))}
      <Html position={[x, topY, z]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="px-1.5 py-0.5 -translate-y-4 bg-[#0e0e0e]/85 text-[9.5px] font-semibold tabular-nums tracking-[0.08em] text-[#f6f4ee] whitespace-nowrap shadow-sm">
          +{topY.toFixed(1)} m
        </div>
      </Html>
    </>
  );
}

function FloorRing({
  y,
  polygon,
  hole,
  emphasis,
}: {
  y: number;
  polygon: Point[];
  hole?: Point[];
  emphasis: boolean;
}) {
  const color = emphasis ? "#1c2417" : "#2a3525";
  const width = emphasis ? 2 : 1;
  const opacity = emphasis ? 0.85 : 0.45;
  // Push the ring slightly outside the facade (or inside for holes) so it
  // hugs the visible surface without z-fighting, and stays depth-tested —
  // rings read as facade floor lines instead of an x-ray overlay.
  const ringPoints = (poly: Point[], grow: number): [number, number, number][] => {
    const c = polygonCentroid(poly);
    const shifted = poly.map((p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * grow, y: p.y + (dy / len) * grow };
    });
    const r: [number, number, number][] = shifted.map((p) => [p.x, y, -p.y] as [number, number, number]);
    r.push([shifted[0].x, y, -shifted[0].y]);
    return r;
  };
  return (
    <>
      <Line
        points={ringPoints(polygon, 0.08)}
        color={color}
        lineWidth={width}
        transparent
        opacity={opacity}
      />
      {hole && hole.length >= 3 && (
        <Line
          points={ringPoints(hole, -0.08)}
          color={color}
          lineWidth={width}
          transparent
          opacity={opacity}
        />
      )}
    </>
  );
}

function polyToShape(points: Point[]): THREE.Shape | null {
  if (points.length < 3) return null;
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].y);
  s.closePath();
  return s;
}

function closedPoints(points: Point[], elev: number): [number, number, number][] {
  if (points.length === 0) return [];
  const result: [number, number, number][] = points.map((p) => [p.x, elev, -p.y]);
  result.push([points[0].x, elev, -points[0].y]);
  return result;
}

function FrontMarker({ plot }: { plot: Point[] }) {
  const bbox = polygonBBox(plot);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const size = Math.max(0.4, Math.min(bbox.w, bbox.h) * 0.04);
  const z = -(bbox.minY - size);
  return (
    <mesh position={[cx, 0.05, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <coneGeometry args={[size, size * 1.6, 3]} />
      <meshBasicMaterial color="#647d57" />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*                        Parametric residential facade                       */
/* -------------------------------------------------------------------------- */

const SLAB_T = 0.22;          // floor slab thickness (m)
const SLAB_LIP = 0.12;        // slab projection beyond the facade line (m)
const GLASS_INSET = 0.16;     // curtain-wall setback behind the facade line (m)
const MULLION_W = 0.12;       // vertical mullion section (m)
const RAIL_H = 1.05;          // balustrade height (m)

/**
 * Models a residential tower facade from the massing polygon: floor slabs,
 * a recessed glazing body, vertical mullions on a parametric bay rhythm and
 * balconies on every Nth bay. All repeated elements are instanced.
 */
function ResidentialFacade({
  polygon, hole, fromY, toY, floorHeight, params,
}: {
  polygon: Point[];
  hole?: Point[];
  fromY: number;
  toY: number;
  floorHeight: number;
  params: FacadeParams;
}) {
  const { panelWidthM, balconyDepthM, balconyEveryNBays, solidPanelRatio, balconyLayout, patternSeed } = params;
  const height = toY - fromY;
  const floors = Math.max(1, Math.round(height / Math.max(0.1, floorHeight)));
  const floorH = height / floors;

  const glassShape = useMemo(() => {
    const inset = offsetPolygon(polygon, polygon.map(() => GLASS_INSET));
    const s = polyToShape(inset.length >= 3 ? inset : polygon);
    if (s && hole && hole.length >= 3) {
      const grown = offsetPolygon(hole, hole.map(() => -GLASS_INSET));
      const src = (grown.length >= 3 ? grown : hole).slice().reverse();
      const path = new THREE.Path();
      path.moveTo(src[0].x, src[0].y);
      for (let i = 1; i < src.length; i++) path.lineTo(src[i].x, src[i].y);
      path.closePath();
      s.holes.push(path);
    }
    return s;
  }, [polygon, hole]);

  const slabShape = useMemo(() => {
    const grown = offsetPolygon(polygon, polygon.map(() => -SLAB_LIP));
    const s = polyToShape(grown.length >= 3 ? grown : polygon);
    if (s && hole && hole.length >= 3) {
      const shrunk = offsetPolygon(hole, hole.map(() => SLAB_LIP));
      const src = (shrunk.length >= 3 ? shrunk : hole).slice().reverse();
      const path = new THREE.Path();
      path.moveTo(src[0].x, src[0].y);
      for (let i = 1; i < src.length; i++) path.lineTo(src[i].x, src[i].y);
      path.closePath();
      s.holes.push(path);
    }
    return s;
  }, [polygon, hole]);

  const { mullions, balconySlabs, rails, solidsLight, solidsDark } = useMemo(() => {
    const mullions: THREE.Matrix4[] = [];
    const balconySlabs: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const solidsLight: THREE.Matrix4[] = [];
    const solidsDark: THREE.Matrix4[] = [];
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

    const ccw = isCounterClockwise(polygon);
    const outSign = ccw ? 1 : -1; // outward normal = (uy,-ux) for CCW polygons (local xy)
    const panelW = Math.max(1, panelWidthM);
    const everyN = Math.max(1, Math.round(balconyEveryNBays));
    const solidRatio = Math.min(1, Math.max(0, solidPanelRatio));
    const seed = Math.floor(patternSeed) || 1;
    const mullionH = floorH - SLAB_T;
    const panelH = floorH - SLAB_T;
    let globalBay = 0;

    for (let e = 0; e < polygon.length; e++) {
      const a = polygon[e];
      const b = polygon[(e + 1) % polygon.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 0.8) continue;
      const ux = ex / len;
      const uy = ey / len;
      const nx = uy * outSign;
      const ny = -ux * outSign;
      // Yaw that aligns the box's local X with the edge direction in world space.
      const yaw = Math.atan2(uy, ux);
      quat.setFromAxisAngle(yAxis, yaw);
      const bays = Math.max(1, Math.round(len / panelW));
      const bayLen = len / bays;

      for (let k = 0; k < bays; k++, globalBay++) {
        // Vertical mullion at the bay start (the next edge contributes its own corner mullion).
        const px = a.x + ux * bayLen * k + nx * 0.02;
        const py = a.y + uy * bayLen * k + ny * 0.02;
        for (let f = 0; f < floors; f++) {
          const yMid = fromY + f * floorH + SLAB_T + mullionH / 2;
          pos.set(px, yMid, -py);
          scale.set(MULLION_W, mullionH, MULLION_W);
          mullions.push(new THREE.Matrix4().compose(pos, quat, scale));
        }

        const cx = a.x + ux * bayLen * (k + 0.5);
        const cy = a.y + uy * bayLen * (k + 0.5);
        const w = bayLen * 0.9;

        for (let f = 0; f < floors; f++) {
          // Solid precast panel instead of glazing on a random subset of cells.
          const isSolid = solidRatio > 0 && cellRand(seed, globalBay, f) < solidRatio;
          if (isSolid) {
            const yMid = fromY + f * floorH + SLAB_T + panelH / 2;
            pos.set(cx, yMid, -cy);
            scale.set(Math.max(0.3, bayLen - MULLION_W), panelH, 0.16);
            const m = new THREE.Matrix4().compose(pos, quat, scale);
            if (cellRand(seed, globalBay, f, 2) < 0.7) solidsLight.push(m);
            else solidsDark.push(m);
          }

          // Balconies: never on the tower's base floor line or on solid cells.
          if (f === 0 || isSolid || balconyDepthM <= 0.05) continue;
          const hasBalcony =
            balconyLayout === "random"
              ? cellRand(seed, globalBay, f, 1) < 1 / everyN
              : globalBay % everyN === 0;
          if (!hasBalcony) continue;
          const yBase = fromY + f * floorH;
          // slab
          pos.set(cx + nx * (balconyDepthM / 2), yBase + 0.07, -(cy + ny * (balconyDepthM / 2)));
          scale.set(w, 0.14, balconyDepthM);
          balconySlabs.push(new THREE.Matrix4().compose(pos, quat, scale));
          // glass balustrade on the outer edge
          pos.set(cx + nx * (balconyDepthM - 0.03), yBase + 0.14 + RAIL_H / 2, -(cy + ny * (balconyDepthM - 0.03)));
          scale.set(w, RAIL_H, 0.05);
          rails.push(new THREE.Matrix4().compose(pos, quat, scale));
        }
      }
    }
    return { mullions, balconySlabs, rails, solidsLight, solidsDark };
  }, [polygon, fromY, floors, floorH, panelWidthM, balconyDepthM, balconyEveryNBays, solidPanelRatio, balconyLayout, patternSeed]);

  return (
    <group>
      {/* Recessed glazing body — stops under the roof slab so the roof reads opaque */}
      {glassShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, fromY, 0]} castShadow receiveShadow>
          <extrudeGeometry args={[glassShape, { depth: Math.max(0.1, height - SLAB_T), bevelEnabled: false }]} />
          <meshPhysicalMaterial
            color="#5e7a70"
            roughness={0.18}
            metalness={0.35}
            clearcoat={0.6}
            clearcoatRoughness={0.25}
            transparent
            opacity={0.82}
          />
        </mesh>
      )}
      {/* Floor slabs (including roof slab) */}
      {slabShape &&
        Array.from({ length: floors + 1 }, (_, i) => {
          const y = i === floors ? toY - SLAB_T : fromY + i * floorH;
          return (
            <mesh key={`slab-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} castShadow receiveShadow>
              <extrudeGeometry args={[slabShape, { depth: SLAB_T, bevelEnabled: false }]} />
              <meshStandardMaterial color="#ddd8ca" roughness={0.85} metalness={0} />
            </mesh>
          );
        })}
      <InstancedBoxes matrices={mullions} color="#e9e5d8" roughness={0.7} />
      <InstancedBoxes matrices={solidsLight} color="#e6e0d0" roughness={0.85} />
      <InstancedBoxes matrices={solidsDark} color="#b9b2a0" roughness={0.85} />
      <InstancedBoxes matrices={balconySlabs} color="#ddd8ca" roughness={0.85} />
      <InstancedBoxes matrices={rails} color="#9fb7ae" roughness={0.15} metalness={0.2} opacity={0.45} />
    </group>
  );
}

/** Renders a set of unit boxes with per-instance transforms. */
function InstancedBoxes({
  matrices, color, roughness = 0.8, metalness = 0, opacity = 1,
}: {
  matrices: THREE.Matrix4[];
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh
      key={matrices.length}
      ref={ref}
      args={[undefined, undefined, matrices.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </instancedMesh>
  );
}

/**
 * Full-height vertical fin/louvre screen wrapping a Ground or Podium
 * footprint — thin blades spaced along the perimeter, projecting outward
 * from the facade line, in front of the solid tier volume.
 */
function VerticalFinScreen({
  polygon, fromY, toY, params,
}: {
  polygon: Point[];
  fromY: number;
  toY: number;
  params: FacadeParams;
}) {
  const { finSpacingM, finWidthM, finDepthM } = params;
  const height = toY - fromY;

  const fins = useMemo(() => {
    const matrices: THREE.Matrix4[] = [];
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const midY = fromY + height / 2;

    const ccw = isCounterClockwise(polygon);
    const outSign = ccw ? 1 : -1; // outward normal = (uy,-ux) for CCW polygons (local xy)
    const spacing = Math.max(0.2, finSpacingM);
    const finW = Math.max(0.03, finWidthM);
    const finD = Math.max(0.05, finDepthM);

    for (let e = 0; e < polygon.length; e++) {
      const a = polygon[e];
      const b = polygon[(e + 1) % polygon.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 0.4) continue;
      const ux = ex / len;
      const uy = ey / len;
      const nx = uy * outSign;
      const ny = -ux * outSign;
      const yaw = Math.atan2(uy, ux);
      quat.setFromAxisAngle(yAxis, yaw);

      const count = Math.max(1, Math.round(len / spacing));
      const step = len / count;
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) * step;
        // Inner face of the blade sits on the facade line; it projects outward by finD.
        const px = a.x + ux * t + nx * (finD / 2);
        const py = a.y + uy * t + ny * (finD / 2);
        pos.set(px, midY, -py);
        scale.set(finW, height, finD);
        matrices.push(new THREE.Matrix4().compose(pos, quat, scale));
      }
    }
    return matrices;
  }, [polygon, fromY, height, finSpacingM, finWidthM, finDepthM]);

  return <InstancedBoxes matrices={fins} color="#9c8f6e" roughness={0.5} metalness={0.25} />;
}

/* -------------------------------------------------------------------------- */
/*                          Podium roof amenities                             */
/* -------------------------------------------------------------------------- */

function boxMatrix(center: Point, y: number, sizeAlong: number, height: number, sizeAcross: number, yaw: number): THREE.Matrix4 {
  const pos = new THREE.Vector3(center.x, y, -center.y);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const scale = new THREE.Vector3(sizeAlong, height, sizeAcross);
  return new THREE.Matrix4().compose(pos, quat, scale);
}

function PodiumAmenities({
  pool, lounge, toY,
}: {
  pool: PlacedAmenity | null;
  lounge: PlacedAmenity | null;
  toY: number;
}) {
  return (
    <>
      {pool && <Pool plan={pool} toY={toY} />}
      {lounge && <LoungeBbq plan={lounge} toY={toY} />}
    </>
  );
}

/** A shallow water surface on a coping rim, sized and placed by planPodiumAmenities. */
function Pool({ plan, toY }: { plan: PlacedAmenity; toY: number }) {
  const { center, length, width, yaw } = plan;
  const rim = useMemo(() => [boxMatrix(center, toY + 0.06, length + 0.6, 0.12, width + 0.6, yaw)], [center, toY, length, width, yaw]);
  const water = useMemo(() => [boxMatrix(center, toY + 0.11, length, 0.06, width, yaw)], [center, toY, length, width, yaw]);
  return (
    <>
      <InstancedBoxes matrices={rim} color="#d8d3c2" roughness={0.9} />
      <InstancedBoxes matrices={water} color="#2f8a92" roughness={0.05} metalness={0.3} opacity={0.88} />
    </>
  );
}

/** A row of sun loungers plus a BBQ counter block at one end, laid out within the planned rectangle. */
function LoungeBbq({ plan, toY }: { plan: PlacedAmenity; toY: number }) {
  const { center, length, width, yaw } = plan;

  const { loungers, bbq } = useMemo(() => {
    // "along" tracks the edge direction (maps to a box's local +X once rotated
    // by `yaw`); "across" tracks the perpendicular direction (local +Z). Both
    // derived directly from yaw so they always agree with boxMatrix's rotation.
    const along: Point = { x: Math.cos(yaw), y: Math.sin(yaw) };
    const across: Point = { x: Math.sin(yaw), y: -Math.cos(yaw) };
    const toWorld = (alongT: number, acrossT: number): Point => ({
      x: center.x + along.x * alongT + across.x * acrossT,
      y: center.y + along.y * alongT + across.y * acrossT,
    });

    const bbqLen = Math.min(length * 0.3, 2.4);
    const bbqDepth = Math.min(width * 0.7, 0.9);
    const bbqAlong = length / 2 - bbqLen / 2; // flush against the "+along" end

    const loungeZoneLen = length - bbqLen - 1;
    const loungerThickness = 0.9; // along-axis footprint per lounger, including its gap
    const loungerCount = Math.max(0, Math.floor(loungeZoneLen / loungerThickness));
    const loungerLen = Math.min(width * 0.75, 2.0); // the lounger's long dimension, across-axis
    const loungerWidth = 0.75; // along-axis footprint before the gap
    const startAlong = -length / 2;
    const span = loungerCount * loungerThickness;
    const loungerStart = startAlong + Math.max(0, (loungeZoneLen - span) / 2);

    const loungers: THREE.Matrix4[] = [];
    for (let i = 0; i < loungerCount; i++) {
      const alongT = loungerStart + i * loungerThickness + loungerWidth / 2;
      loungers.push(boxMatrix(toWorld(alongT, 0), toY + 0.18, loungerWidth, 0.35, loungerLen, yaw));
    }
    const bbq = [boxMatrix(toWorld(bbqAlong, 0), toY + 0.48, bbqLen, 0.95, bbqDepth, yaw)];

    return { loungers, bbq };
  }, [center, length, width, yaw, toY]);

  return (
    <>
      <InstancedBoxes matrices={loungers} color="#a9855f" roughness={0.65} />
      <InstancedBoxes matrices={bbq} color="#3f3d38" roughness={0.5} metalness={0.15} />
    </>
  );
}

function colourForKind(kind?: "tower" | "ground" | "podium" | "basement") {
  switch (kind) {
    case "ground":
      return { fill: "#8a9a76", edge: "#3a4a30", opacity: 1, roughness: 0.75 };
    case "podium":
      return { fill: "#a3b08a", edge: "#3a4a30", opacity: 1, roughness: 0.75 };
    case "basement":
      return { fill: "#bdb9ad", edge: "#5a564c", opacity: 0.55, roughness: 0.9 };
    case "tower":
    default:
      return { fill: "#647d57", edge: "#33422e", opacity: 1, roughness: 0.5 };
  }
}
