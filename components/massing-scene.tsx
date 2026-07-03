"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, Line, ContactShadows, Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Point } from "@/lib/geom";
import { polygonBBox, polygonCentroid } from "@/lib/geom";
import type { Volume } from "@/lib/massing";

export type ViewPresetKind = "iso" | "front" | "top";

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
}

interface CameraGoal {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
}

export default function MassingScene(props: SceneProps) {
  const {
    plot, buildable, volumes, floorHeight, showFrontMarker, edgeColors,
    volumeLabels, showAnnotations = true, viewPreset, autoRotate, captureRef,
  } = props;

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
    const out: { y: number; polygon: Point[]; hole?: Point[]; emphasis: boolean }[] = [];
    for (const v of volumes) {
      // Floor levels inside this volume, excluding top and bottom (those are mesh edges)
      const startFloor = Math.floor(v.fromY / floorHeight) + 1;
      const endFloor = Math.ceil(v.toY / floorHeight) - 1;
      for (let f = startFloor; f <= endFloor; f++) {
        const y = f * floorHeight;
        if (y <= v.fromY + 1e-3 || y >= v.toY - 1e-3) continue;
        out.push({ y, polygon: v.polygon, hole: v.hole, emphasis: f % 5 === 0 });
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
        const colours = colourForKind(v.kind);
        return (
          <mesh
            key={i}
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
        );
      })}

      {/* Floor-level rings around each volume — emphasised every 5 floors */}
      {floorRings.map((r, i) => (
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
