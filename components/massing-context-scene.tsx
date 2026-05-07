"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Edges, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { GoogleCloudAuthPlugin, ReorientationPlugin, TilesFadePlugin } from "3d-tiles-renderer/plugins";
import type { Point } from "@/lib/geom";
import { polygonBBox } from "@/lib/geom";
import type { Volume } from "@/lib/massing";

export interface ContextSceneProps {
  plot: Point[];
  buildable: Point[];
  volumes: Volume[];
  floorHeight: number;
  primaryFootprint?: Point[];
  edgeColors?: string[];
  latitude: number;
  longitude: number;
  /** Heading of plot's +Y axis relative to true north, degrees clockwise */
  northHeadingDeg: number;
  /** Google Cloud Map Tiles API key */
  apiKey: string;
}

export default function MassingContextScene(props: ContextSceneProps) {
  const {
    plot, volumes, floorHeight, edgeColors,
    latitude, longitude, northHeadingDeg, apiKey,
  } = props;
  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const maxDim = Math.max(bbox.w, bbox.h, ...volumes.map((v) => v.toY), 30);
  const camDist = Math.max(maxDim * 1.6, 200);
  const headingRad = (northHeadingDeg * Math.PI) / 180;

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        camera={{
          position: [camDist * 0.85, camDist * 0.7, camDist],
          fov: 45,
          near: 0.5,
          far: 1e8,
        }}
        style={{ background: "#9bb3c4" }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[200, 400, 250]} intensity={0.9} castShadow />

        {apiKey && <GoogleTiles apiKey={apiKey} latitude={latitude} longitude={longitude} />}

        {/* Building (rotated to align with true north) */}
        <group rotation={[0, -headingRad, 0]}>
          {edgeColors && edgeColors.length === plot.length ? (
            plot.map((p, i) => {
              const next = plot[(i + 1) % plot.length];
              const points: [number, number, number][] = [
                [p.x, 0.05, -p.y],
                [next.x, 0.05, -next.y],
              ];
              return <Line key={`edge-${i}`} points={points} color={edgeColors[i]} lineWidth={3} />;
            })
          ) : (
            <PlotOutline plot={plot} />
          )}

          {volumes.map((v, i) => {
            const shape = polyToShape(v.polygon);
            const depth = v.toY - v.fromY;
            if (!shape || depth <= 0) return null;
            if (v.hole && v.hole.length >= 3) {
              const reversed = v.hole.slice().reverse();
              const path = new THREE.Path();
              path.moveTo(reversed[0].x, reversed[0].y);
              for (let j = 1; j < reversed.length; j++) path.lineTo(reversed[j].x, reversed[j].y);
              path.closePath();
              shape.holes.push(path);
            }
            return (
              <mesh
                key={i}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, v.fromY, 0]}
                castShadow
                receiveShadow
              >
                <extrudeGeometry args={[shape, { depth, bevelEnabled: false }]} />
                <meshStandardMaterial color="#647d57" roughness={0.55} metalness={0.1} />
                <Edges color="#33422e" threshold={1} />
              </mesh>
            );
          })}

          {volumes.map((v, vi) => {
            if (floorHeight <= 0) return null;
            const startFloor = Math.floor(v.fromY / floorHeight) + 1;
            const endFloor = Math.ceil(v.toY / floorHeight) - 1;
            const rings: { y: number; emphasis: boolean }[] = [];
            for (let f = startFloor; f <= endFloor; f++) {
              const y = f * floorHeight;
              if (y > v.fromY + 1e-3 && y < v.toY - 1e-3) {
                rings.push({ y, emphasis: f % 5 === 0 });
              }
            }
            return rings.map((r, ri) => {
              const points: [number, number, number][] = v.polygon.map(
                (p) => [p.x, r.y, -p.y] as [number, number, number]
              );
              points.push([v.polygon[0].x, r.y, -v.polygon[0].y]);
              return (
                <Line
                  key={`fl-${vi}-${ri}`}
                  points={points}
                  color={r.emphasis ? "#0a0a0a" : "#2a3525"}
                  lineWidth={r.emphasis ? 2.4 : 1.2}
                  transparent
                  opacity={r.emphasis ? 0.95 : 0.7}
                  depthTest={false}
                  depthWrite={false}
                  renderOrder={2}
                />
              );
            });
          })}
        </group>

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          target={[0, maxDim / 4, 0]}
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={20}
          maxDistance={maxDim * 30}
        />
      </Canvas>

      {!apiKey && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-amber-50 text-[10.5px] text-amber-900 border border-amber-200">
          Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Netlify and redeploy.
        </div>
      )}
      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-white/85 text-[9px] text-ink-700 border border-ink-200">
        © Google · Photorealistic 3D Tiles
      </div>
    </div>
  );
}

function GoogleTiles({
  apiKey,
  latitude,
  longitude,
}: {
  apiKey: string;
  latitude: number;
  longitude: number;
}) {
  const { camera, gl, scene } = useThree();
  const tilesRef = useRef<TilesRenderer | null>(null);

  useEffect(() => {
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    tiles.registerPlugin(
      new ReorientationPlugin({
        lat: (latitude * Math.PI) / 180,
        lon: (longitude * Math.PI) / 180,
        height: 0,
        up: "+y",
        recenter: true,
      })
    );
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.fetchOptions.mode = "cors";
    tiles.errorTarget = 24;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, gl);
    scene.add(tiles.group);
    tilesRef.current = tiles;
    return () => {
      try {
        scene.remove(tiles.group);
        tiles.dispose();
      } catch {
        /* ignore */
      }
      tilesRef.current = null;
    };
  }, [apiKey, latitude, longitude, camera, gl, scene]);

  useFrame(() => {
    const t = tilesRef.current;
    if (!t) return;
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, gl);
    t.update();
  });

  return null;
}

/* ---------- helpers ---------- */

function polyToShape(points: Point[]): THREE.Shape | null {
  if (points.length < 3) return null;
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].y);
  s.closePath();
  return s;
}

function PlotOutline({ plot }: { plot: Point[] }) {
  const points: [number, number, number][] = plot.map((p) => [p.x, 0.05, -p.y]);
  if (plot.length > 0) points.push([plot[0].x, 0.05, -plot[0].y]);
  return <Line points={points} color="#3f5135" lineWidth={1.6} />;
}
