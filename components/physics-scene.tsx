"use client";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Volume } from "@/lib/massing";
import type { PanelValue } from "@/lib/building-physics";
import { polygonBBox } from "@/lib/geom";

export type ColorScheme = "viridis" | "view" | "solar" | "shadow";

interface PhysicsSceneProps {
  volumes: Volume[];
  panelValues?: PanelValue[];
  scheme: ColorScheme;
}

export default function PhysicsScene({
  volumes,
  panelValues,
  scheme,
}: PhysicsSceneProps) {
  // Camera target & distance based on the building's extent
  const stats = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
    for (const v of volumes) {
      const bb = polygonBBox(v.polygon);
      if (bb.minX < x0) x0 = bb.minX;
      if (bb.maxX > x1) x1 = bb.maxX;
      // shape Y → world -Z
      if (-bb.maxY < z0) z0 = -bb.maxY;
      if (-bb.minY > z1) z1 = -bb.minY;
      if (v.toY > top) top = v.toY;
    }
    if (!Number.isFinite(x0)) { x0 = -50; x1 = 50; z0 = -50; z1 = 50; top = 30; }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const span = Math.max(x1 - x0, z1 - z0, top, 30);
    return { cx, cz, top, span };
  }, [volumes]);

  const camDist = stats.span * 1.3;

  return (
    <Canvas
      orthographic
      shadows
      camera={{
        position: [stats.cx + camDist * 0.6, camDist * 0.7, stats.cz + camDist],
        near: 0.1,
        far: stats.span * 60,
        zoom: 1,
      }}
      style={{ background: "#f4f1e8" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[200, 320, 140]} intensity={0.6} />

      {/* Ground plate for context */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[stats.cx, -0.1, stats.cz]}
        receiveShadow
      >
        <planeGeometry args={[stats.span * 3, stats.span * 3]} />
        <meshStandardMaterial color="#ece5d2" roughness={1} />
      </mesh>

      {/* Project building — neutral grey so coloured panels stand out */}
      {volumes.map((v, i) => (
        <VolumeMesh key={i} volume={v} />
      ))}

      {/* Heatmap panels */}
      {panelValues && panelValues.length > 0 && (
        <PanelInstances panelValues={panelValues} scheme={scheme} />
      )}

      <OrbitControls
        target={[stats.cx, stats.top / 3, stats.cz]}
        enablePan
        enableZoom
        enableRotate
        maxPolarAngle={Math.PI / 2 - 0.02}
        minZoom={0.2}
        maxZoom={6}
      />
    </Canvas>
  );
}

function VolumeMesh({ volume }: { volume: Volume }) {
  const shape = useMemo(() => {
    if (volume.polygon.length < 3) return null;
    const s = new THREE.Shape();
    s.moveTo(volume.polygon[0].x, volume.polygon[0].y);
    for (let i = 1; i < volume.polygon.length; i++) {
      s.lineTo(volume.polygon[i].x, volume.polygon[i].y);
    }
    s.closePath();
    if (volume.hole && volume.hole.length >= 3) {
      const reversed = volume.hole.slice().reverse();
      const path = new THREE.Path();
      path.moveTo(reversed[0].x, reversed[0].y);
      for (let i = 1; i < reversed.length; i++) path.lineTo(reversed[i].x, reversed[i].y);
      path.closePath();
      s.holes.push(path);
    }
    return s;
  }, [volume.polygon, volume.hole]);
  const depth = volume.toY - volume.fromY;
  if (!shape || depth <= 0) return null;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, volume.fromY, 0]}
      castShadow
      receiveShadow
    >
      <extrudeGeometry args={[shape, { depth, bevelEnabled: false }]} />
      <meshStandardMaterial color="#dad5c4" roughness={0.95} metalness={0} />
      <Edges color="#5a5750" threshold={1} />
    </mesh>
  );
}

function PanelInstances({
  panelValues,
  scheme,
}: {
  panelValues: PanelValue[];
  scheme: ColorScheme;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!meshRef.current) return;
    const m = meshRef.current;
    // Pre-initialise the instance colour buffer so setColorAt has somewhere to write.
    if (!m.instanceColor || m.instanceColor.count !== panelValues.length) {
      m.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(panelValues.length * 3),
        3,
      );
    }
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    const planeForward = new THREE.Vector3(0, 0, 1);
    const normalVec = new THREE.Vector3();
    for (let i = 0; i < panelValues.length; i++) {
      const { panel, value } = panelValues[i];
      dummy.position.set(panel.pos.x, panel.pos.y, panel.pos.z);
      normalVec.set(panel.normal.x, panel.normal.y, panel.normal.z).normalize();
      // Align the plane's +Z (front face normal) with the panel's outward normal.
      dummy.quaternion.setFromUnitVectors(planeForward, normalVec);
      dummy.scale.set(panel.widthM * 0.95, panel.heightM * 0.95, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      mapToColour(value, scheme, c);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }, [panelValues, scheme]);
  return (
    <instancedMesh
      ref={meshRef}
      // Force a remount when the panel count changes so InstancedMesh's internal
      // buffers are sized correctly (args only run on construction).
      key={`pi-${panelValues.length}`}
      args={[undefined, undefined, panelValues.length]}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
      {/* No vertexColors prop — that would force the shader to expect a per-vertex
          colour attribute on the geometry. We only want per-INSTANCE colour, which
          three.js auto-enables when instanceColor is populated. */}
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

/* ---------- colour maps ---------- */

function mapToColour(value: number, scheme: ColorScheme, out: THREE.Color) {
  switch (scheme) {
    case "viridis": {
      // 0 = dark purple → 1 = yellow.
      const stops: [number, [number, number, number]][] = [
        [0.0, [0.27, 0.00, 0.33]],
        [0.25, [0.23, 0.32, 0.55]],
        [0.50, [0.13, 0.57, 0.55]],
        [0.75, [0.36, 0.79, 0.39]],
        [1.0, [0.99, 0.91, 0.14]],
      ];
      const [r, g, b] = sampleStops(stops, clamp01(value));
      out.setRGB(r, g, b);
      return;
    }
    case "view": {
      // Red (no view) → green (full view).
      const stops: [number, [number, number, number]][] = [
        [0.0, [0.85, 0.18, 0.18]],
        [0.5, [0.93, 0.78, 0.20]],
        [1.0, [0.32, 0.66, 0.32]],
      ];
      const [r, g, b] = sampleStops(stops, clamp01(value));
      out.setRGB(r, g, b);
      return;
    }
    case "solar": {
      // Cool blue (low) → warm orange/yellow (high). Quasi-inferno ramp.
      const stops: [number, [number, number, number]][] = [
        [0.0, [0.05, 0.06, 0.30]],
        [0.25, [0.40, 0.10, 0.50]],
        [0.50, [0.79, 0.27, 0.40]],
        [0.75, [0.96, 0.55, 0.20]],
        [1.0, [0.99, 0.93, 0.55]],
      ];
      const [r, g, b] = sampleStops(stops, clamp01(value));
      out.setRGB(r, g, b);
      return;
    }
    case "shadow": {
      // Binary: lit (warm yellow) vs shaded (deep navy).
      if (value > 0.5) out.setHex(0xf2c14e);
      else out.setHex(0x2c3e6b);
      return;
    }
  }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function sampleStops(
  stops: [number, [number, number, number]][],
  t: number,
): [number, number, number] {
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return stops[stops.length - 1][1];
}
