"use client";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Edges, Line } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
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
  /** Mapbox public token */
  mapboxToken: string;
  /** Half-side of the satellite image footprint in metres (controls zoom). */
  contextRadiusM?: number;
}

/** Approximate equirectangular projection — fine for ~1 km radius around the origin */
const M_PER_DEG_LAT = 111320;
function metersPerDegLng(latDeg: number) {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}
function latLngToLocalXY(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number
): { x: number; y: number } {
  const x = (lng - originLng) * metersPerDegLng(originLat);
  const y = (lat - originLat) * M_PER_DEG_LAT;
  return { x, y };
}

interface OsmBuilding {
  polygon: Point[]; // local metres relative to project origin
  height: number;
}

export default function MassingContextScene(props: ContextSceneProps) {
  const {
    plot, volumes, floorHeight, edgeColors,
    latitude, longitude, northHeadingDeg, mapboxToken,
    contextRadiusM = 350,
  } = props;

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const maxDim = Math.max(bbox.w, bbox.h, ...volumes.map((v) => v.toY), 30);
  const camDist = Math.max(contextRadiusM * 1.4, maxDim * 1.5);
  const headingRad = (northHeadingDeg * Math.PI) / 180;

  // Pick a Mapbox zoom that approximately covers contextRadiusM half-side.
  // metres-per-pixel ≈ 156543 * cos(lat) / 2^zoom (web-mercator)
  // image is rendered at 1024 px @2x = 2048 effective px → 1024 px after CSS
  // We want imageSizeM ≈ 2 × contextRadius
  // imageSizeM = imagePixels × metresPerPixel = 1024 × 156543·cos(lat) / 2^zoom
  // → zoom ≈ log2(1024 × 156543 × cos(lat) / imageSizeM)
  const zoom = useMemo(() => {
    const m = (1024 * 156543 * Math.cos((latitude * Math.PI) / 180)) / (2 * contextRadiusM);
    return Math.max(13, Math.min(20, Math.round(Math.log2(m))));
  }, [latitude, contextRadiusM]);

  const satelliteUrl = useMemo(() => {
    if (!mapboxToken) return "";
    // 1024×1024 @2x = 2048 logical, free tier
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${longitude},${latitude},${zoom},0/1024x1024@2x?access_token=${mapboxToken}`;
  }, [longitude, latitude, zoom, mapboxToken]);

  // Compute the actual ground-plane size that matches the chosen zoom
  const groundSizeM = useMemo(() => {
    const mPerPx = (156543 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
    return 1024 * mPerPx;
  }, [latitude, zoom]);

  // Fetch OSM buildings around the project on mount / coords change
  const [osmBuildings, setOsmBuildings] = useState<OsmBuilding[]>([]);
  const [osmLoading, setOsmLoading] = useState(false);
  const [osmError, setOsmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchOSM() {
      setOsmLoading(true);
      setOsmError(null);
      try {
        const radius = Math.round(contextRadiusM);
        const query = `[out:json][timeout:25];way[building](around:${radius},${latitude},${longitude});(._;>;);out;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`OSM fetch ${res.status}`);
        const data = (await res.json()) as { elements: OsmElement[] };
        if (cancelled) return;
        setOsmBuildings(parseOsm(data.elements, latitude, longitude));
      } catch (e) {
        if (!cancelled) setOsmError(e instanceof Error ? e.message : "OSM fetch failed");
      } finally {
        if (!cancelled) setOsmLoading(false);
      }
    }
    fetchOSM();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, contextRadiusM]);

  return (
    <Canvas
      shadows
      camera={{
        position: [camDist * 0.85, camDist * 0.7, camDist],
        fov: 45,
        near: 0.5,
        far: maxDim * 200,
      }}
      style={{ background: "#bccbd6" }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={0.65} />
      <directionalLight position={[300, 500, 200]} intensity={0.9} castShadow />

      {/* Satellite ground texture */}
      <Suspense fallback={null}>
        {satelliteUrl && <SatelliteGround url={satelliteUrl} sizeM={groundSizeM} />}
      </Suspense>

      {/* OSM extruded buildings around the plot */}
      {osmBuildings.map((b, i) => (
        <OsmBuildingMesh key={i} polygon={b.polygon} height={b.height} />
      ))}

      {/* Project building (rotated by north heading) */}
      <group rotation={[0, -headingRad, 0]}>
        {edgeColors && edgeColors.length === plot.length ? (
          plot.map((p, i) => {
            const next = plot[(i + 1) % plot.length];
            const pts: [number, number, number][] = [
              [p.x, 0.15, -p.y],
              [next.x, 0.15, -next.y],
            ];
            return <Line key={`edge-${i}`} points={pts} color={edgeColors[i]} lineWidth={3} />;
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

        {/* Floor rings */}
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
        maxDistance={contextRadiusM * 8}
      />
    </Canvas>
  );
}

/* ---------- helpers ---------- */

function SatelliteGround({ url, sizeM }: { url: string; sizeM: number }) {
  const texture = useLoader(THREE.TextureLoader, url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[sizeM, sizeM]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  );
}

function OsmBuildingMesh({ polygon, height }: { polygon: Point[]; height: number }) {
  const shape = useMemo(() => {
    if (polygon.length < 3) return null;
    const s = new THREE.Shape();
    s.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) s.lineTo(polygon[i].x, polygon[i].y);
    s.closePath();
    return s;
  }, [polygon]);
  if (!shape || height <= 0) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow castShadow>
      <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
      <meshStandardMaterial color="#cdcdc7" roughness={0.85} metalness={0.05} />
    </mesh>
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

function PlotOutline({ plot }: { plot: Point[] }) {
  const points: [number, number, number][] = plot.map((p) => [p.x, 0.15, -p.y]);
  if (plot.length > 0) points.push([plot[0].x, 0.15, -plot[0].y]);
  return <Line points={points} color="#3f5135" lineWidth={1.6} />;
}

/* ---------- OSM Overpass parsing ---------- */

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}
interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
type OsmElement = OsmNode | OsmWay;

function parseOsm(elements: OsmElement[], originLat: number, originLng: number): OsmBuilding[] {
  const nodeMap = new Map<number, OsmNode>();
  for (const el of elements) {
    if (el.type === "node") nodeMap.set(el.id, el);
  }
  const buildings: OsmBuilding[] = [];
  for (const el of elements) {
    if (el.type !== "way") continue;
    if (!el.tags?.building) continue;
    const polygon: Point[] = [];
    for (const nid of el.nodes) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      const xy = latLngToLocalXY(n.lat, n.lon, originLat, originLng);
      polygon.push({ x: xy.x, y: xy.y });
    }
    // Drop closing-repeat if present
    if (polygon.length >= 2) {
      const a = polygon[0];
      const b = polygon[polygon.length - 1];
      if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) polygon.pop();
    }
    if (polygon.length < 3) continue;

    const tags = el.tags ?? {};
    const heightTag = tags["height"];
    const levelsTag = tags["building:levels"];
    let height = 0;
    if (heightTag) {
      const n = parseFloat(heightTag);
      if (Number.isFinite(n)) height = n;
    }
    if (height <= 0 && levelsTag) {
      const lv = parseFloat(levelsTag);
      if (Number.isFinite(lv)) height = lv * 3.2;
    }
    if (height <= 0) height = 9; // sensible default for unspecified buildings
    buildings.push({ polygon, height });
  }
  return buildings;
}
