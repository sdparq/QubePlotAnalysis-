"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { Point } from "@/lib/geom";
import { polygonBBox, polygonCentroid } from "@/lib/geom";

export interface SceneProps {
  plot: Point[];           // Plot polygon in plot-local metres
  buildable: Point[];      // Buildable polygon (after setbacks)
  building: Point[];       // Building footprint polygon
  buildingHeight: number;
  numFloors: number;
  floorHeight: number;
  showFrontMarker?: boolean;
  /** Optional per-edge colors for the plot outline (length should match plot.length). */
  edgeColors?: string[];
}

export default function MassingScene(props: SceneProps) {
  const { plot, buildable, building, buildingHeight, numFloors, floorHeight, showFrontMarker, edgeColors } = props;

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const centroid = useMemo(() => polygonCentroid(plot), [plot]);

  // Camera framing
  const maxDim = Math.max(bbox.w, bbox.h, buildingHeight, 30);
  const camDist = maxDim * 1.4;

  // Floor lines around the building, drawn as polylines tracing the footprint
  const floorLines = useMemo(() => {
    if (building.length < 3) return [];
    const out: number[] = [];
    for (let i = 1; i < numFloors; i++) out.push(i * floorHeight);
    return out;
  }, [numFloors, floorHeight, building.length]);

  // Three.js Shape from polygon (in 2D)
  const plotShape = useMemo(() => polyToShape(plot), [plot]);
  const buildableShape = useMemo(() => (buildable.length >= 3 ? polyToShape(buildable) : null), [buildable]);
  const buildingShape = useMemo(() => (building.length >= 3 ? polyToShape(building) : null), [building]);

  // Outlines as Line points
  const plotOutline = useMemo(() => closedPoints(plot, 0.02), [plot]);

  return (
    <Canvas
      shadows
      camera={{
        position: [centroid.x + camDist * 0.85, camDist * 0.7, -centroid.y + camDist],
        fov: 40,
        near: 0.5,
        far: maxDim * 10,
      }}
      style={{ background: "#f6f4ee" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[centroid.x + maxDim * 0.6, maxDim * 1.4, -centroid.y + maxDim * 0.4]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-maxDim}
        shadow-camera-right={maxDim}
        shadow-camera-top={maxDim}
        shadow-camera-bottom={-maxDim}
      />

      <Grid
        args={[maxDim * 4, maxDim * 4]}
        cellSize={1}
        cellThickness={0.4}
        cellColor="#dcd8d0"
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor="#b8b5ad"
        fadeDistance={maxDim * 3}
        fadeStrength={1.4}
        position={[centroid.x, -0.001, -centroid.y]}
        infiniteGrid
      />

      {/* Plot footprint */}
      {plotShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <shapeGeometry args={[plotShape]} />
          <meshStandardMaterial color="#ede9df" />
        </mesh>
      )}

      {/* Buildable area */}
      {buildableShape && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
          <shapeGeometry args={[buildableShape]} />
          <meshStandardMaterial color="#bccab0" opacity={0.9} transparent />
        </mesh>
      )}

      {/* Plot outline — per-edge colored when edgeColors is supplied */}
      {edgeColors && edgeColors.length === plot.length ? (
        plot.map((p, i) => {
          const next = plot[(i + 1) % plot.length];
          const points: [number, number, number][] = [[p.x, 0.02, -p.y], [next.x, 0.02, -next.y]];
          return <Line key={`edge-${i}`} points={points} color={edgeColors[i]} lineWidth={3} />;
        })
      ) : (
        <Line points={plotOutline} color="#3f5135" lineWidth={1.6} />
      )}

      {/* Building extruded mass */}
      {buildingShape && buildingHeight > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} castShadow receiveShadow>
          <extrudeGeometry args={[buildingShape, { depth: buildingHeight, bevelEnabled: false }]} />
          <meshStandardMaterial color="#647d57" roughness={0.6} metalness={0.1} />
          <Edges color="#33422e" threshold={1} />
        </mesh>
      )}

      {/* Floor-level wireframe rings */}
      {floorLines.map((y, i) => (
        <Line
          key={i}
          points={closedPoints(building, 0).map(([x, _, z]) => [x, y, z] as [number, number, number])}
          color="#33422e"
          lineWidth={0.8}
          transparent
          opacity={0.45}
        />
      ))}

      {showFrontMarker && <FrontMarker plot={plot} />}

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        target={[centroid.x, buildingHeight / 3, -centroid.y]}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={5}
        maxDistance={maxDim * 5}
      />
    </Canvas>
  );
}

/** Convert 2D polygon (Point[]) into a THREE.Shape */
function polyToShape(points: Point[]): THREE.Shape | null {
  if (points.length < 3) return null;
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].y);
  s.closePath();
  return s;
}

/** 2D polygon -> closed 3D points on the ground plane (y = elevation, world coords).
 *  Uses the standard scene rotation: 2D (x,y) -> world (x, elev, -y).
 */
function closedPoints(points: Point[], elev: number): [number, number, number][] {
  if (points.length === 0) return [];
  const result: [number, number, number][] = points.map((p) => [p.x, elev, -p.y]);
  result.push([points[0].x, elev, -points[0].y]);
  return result;
}

function FrontMarker({ plot }: { plot: Point[] }) {
  // Front edge of the plot is at minimum 2D y. Marker sits beyond it (-y direction = +Z world).
  const bbox = polygonBBox(plot);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const size = Math.max(0.4, Math.min(bbox.w, bbox.h) * 0.04);
  const z = -(bbox.minY - size); // 2D y = bbox.minY -> world Z = -minY (positive)
  return (
    <mesh position={[cx, 0.05, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <coneGeometry args={[size, size * 1.6, 3]} />
      <meshBasicMaterial color="#647d57" />
    </mesh>
  );
}
