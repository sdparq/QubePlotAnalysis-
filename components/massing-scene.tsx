"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Edges, Line } from "@react-three/drei";
import { useMemo } from "react";

export interface SceneProps {
  /** Plot dimensions in metres */
  frontage: number;
  depth: number;
  /** Setbacks in metres */
  setbackFront: number;
  setbackRear: number;
  setbackSide: number;
  /** Building dimensions */
  buildingWidth: number;
  buildingDepth: number;
  buildingHeight: number;
  /** Number of floors (for floor-line markers) */
  numFloors: number;
  floorHeight: number;
}

export default function MassingScene(props: SceneProps) {
  const {
    frontage, depth,
    setbackFront, setbackRear, setbackSide,
    buildingWidth, buildingDepth, buildingHeight,
    numFloors, floorHeight,
  } = props;

  const buildableW = Math.max(0, frontage - 2 * setbackSide);
  const buildableD = Math.max(0, depth - setbackFront - setbackRear);
  // Front of plot is at +Z, rear at -Z. Buildable area shifts toward rear if front setback is bigger.
  const buildableCenterZ = (setbackRear - setbackFront) / 2;

  // Building centred within the buildable area
  const buildingX = 0;
  const buildingZ = buildableCenterZ;

  const maxDim = Math.max(frontage, depth, buildingHeight, 30);
  const camDist = maxDim * 1.4;

  // Floor lines as horizontal lines at each floor level
  const floorLines = useMemo(() => {
    const lines: number[] = [];
    for (let i = 1; i < numFloors; i++) lines.push(i * floorHeight);
    return lines;
  }, [numFloors, floorHeight]);

  return (
    <Canvas
      shadows
      camera={{ position: [camDist * 0.85, camDist * 0.7, camDist], fov: 40, near: 0.5, far: maxDim * 10 }}
      style={{ background: "#f6f4ee" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[maxDim * 0.6, maxDim * 1.4, maxDim * 0.4]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-maxDim}
        shadow-camera-right={maxDim}
        shadow-camera-top={maxDim}
        shadow-camera-bottom={-maxDim}
      />

      {/* Infinite ground grid */}
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
        position={[0, -0.001, 0]}
        infiniteGrid
      />

      {/* Plot footprint (full parcel) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[frontage, depth]} />
        <meshStandardMaterial color="#ede9df" />
      </mesh>

      {/* Buildable area (within setbacks) */}
      {buildableW > 0 && buildableD > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, buildableCenterZ]} receiveShadow>
          <planeGeometry args={[buildableW, buildableD]} />
          <meshStandardMaterial color="#bccab0" opacity={0.9} transparent />
        </mesh>
      )}

      {/* Plot outline */}
      <PlotOutline frontage={frontage} depth={depth} />

      {/* Building mass */}
      {buildingWidth > 0 && buildingDepth > 0 && buildingHeight > 0 && (
        <mesh
          position={[buildingX, buildingHeight / 2, buildingZ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[buildingWidth, buildingHeight, buildingDepth]} />
          <meshStandardMaterial color="#647d57" roughness={0.6} metalness={0.1} />
          <Edges color="#33422e" threshold={1} />
        </mesh>
      )}

      {/* Floor lines as faint stripes around the building */}
      {floorLines.map((y, i) => (
        <FloorLine
          key={i}
          y={y}
          width={buildingWidth}
          depth={buildingDepth}
          x={buildingX}
          z={buildingZ}
        />
      ))}

      {/* Compass marker — small triangle on the front edge */}
      <FrontMarker frontage={frontage} depth={depth} />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        target={[0, buildingHeight / 3, 0]}
        maxPolarAngle={Math.PI / 2 - 0.03}
        minDistance={5}
        maxDistance={maxDim * 5}
      />
    </Canvas>
  );
}

function PlotOutline({ frontage, depth }: { frontage: number; depth: number }) {
  const hw = frontage / 2;
  const hd = depth / 2;
  const points: [number, number, number][] = [
    [-hw, 0.02, -hd],
    [hw, 0.02, -hd],
    [hw, 0.02, hd],
    [-hw, 0.02, hd],
    [-hw, 0.02, -hd],
  ];
  return <Line points={points} color="#3f5135" lineWidth={1.6} />;
}

function FloorLine({
  y, width, depth, x, z,
}: { y: number; width: number; depth: number; x: number; z: number }) {
  const hw = width / 2;
  const hd = depth / 2;
  const points: [number, number, number][] = [
    [x - hw, y, z - hd],
    [x + hw, y, z - hd],
    [x + hw, y, z + hd],
    [x - hw, y, z + hd],
    [x - hw, y, z - hd],
  ];
  return <Line points={points} color="#33422e" lineWidth={0.8} transparent opacity={0.45} />;
}

function FrontMarker({ frontage, depth }: { frontage: number; depth: number }) {
  // Triangle pointing into the plot from the front (positive Z) edge
  const size = Math.min(frontage, depth) * 0.04;
  return (
    <mesh position={[0, 0.05, depth / 2 + size]} rotation={[-Math.PI / 2, 0, 0]}>
      <coneGeometry args={[size, size * 1.6, 3]} />
      <meshBasicMaterial color="#647d57" />
    </mesh>
  );
}
