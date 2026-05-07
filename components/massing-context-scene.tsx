"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, Line } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
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
  /** Y offset (m) applied to the project building. Useful to push it up/down for fine alignment with the satellite ground. */
  buildingYOffsetM?: number;
  /** Half-side of the satellite imagery footprint in metres. Auto-picks zoom. */
  contextRadiusM?: number;
  /** OSM way id → custom height (m). Replaces OSM-derived default. */
  nearbyHeightOverrides?: Record<string, number>;
  /** OSM way ids hidden from the scene */
  nearbyHidden?: string[];
  /** Persist user edits */
  onSetHeight?: (osmId: string, height: number) => void;
  onToggleHide?: (osmId: string, hide: boolean) => void;
}

/* ---------- Web Mercator helpers ---------- */
const TILE_PX = 256;
function lonLatToWorldPx(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n * TILE_PX;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_PX;
  return { x, y };
}
const M_PER_DEG_LAT = 111320;
const metersPerDegLng = (latDeg: number) => 111320 * Math.cos((latDeg * Math.PI) / 180);
const metersPerPixel = (lat: number, zoom: number) =>
  (156543.03 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
function latLngToLocalXY(lat: number, lng: number, originLat: number, originLng: number) {
  return {
    x: (lng - originLng) * metersPerDegLng(originLat),
    y: (lat - originLat) * M_PER_DEG_LAT,
  };
}

interface OsmBuilding {
  id: string;
  polygon: Point[];
  defaultHeight: number;
  name?: string;
}

interface ContextGround {
  texture: THREE.Texture;
  sizeM: number;
  planeX: number;
  planeZ: number;
}

async function loadEsriContext(lat: number, lon: number, contextRadiusM: number): Promise<ContextGround> {
  const targetSizeM = 2 * contextRadiusM;
  const z = Math.max(
    13,
    Math.min(19, Math.round(Math.log2((768 * 156543 * Math.cos((lat * Math.PI) / 180)) / targetSizeM)))
  );
  const grid = 3;
  const center = lonLatToWorldPx(lon, lat, z);
  const projectTileX = Math.floor(center.x / TILE_PX);
  const projectTileY = Math.floor(center.y / TILE_PX);
  const half = Math.floor(grid / 2);
  const startTileX = projectTileX - half;
  const startTileY = projectTileY - half;
  const canvas = document.createElement("canvas");
  canvas.width = grid * TILE_PX;
  canvas.height = grid * TILE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const tasks: Promise<void>[] = [];
  for (let dy = 0; dy < grid; dy++) {
    for (let dx = 0; dx < grid; dx++) {
      const tx = startTileX + dx;
      const ty = startTileY + dy;
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      tasks.push(
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.drawImage(img, dx * TILE_PX, dy * TILE_PX);
            resolve();
          };
          img.onerror = () => reject(new Error(`Tile fetch failed: ${url}`));
          img.src = url;
        })
      );
    }
  }
  await Promise.all(tasks);
  const mPerPx = metersPerPixel(lat, z);
  const sizePx = grid * TILE_PX;
  const sizeM = sizePx * mPerPx;
  const projectInImagePx = center.x - startTileX * TILE_PX;
  const projectInImagePy = center.y - startTileY * TILE_PX;
  const planeX = -(projectInImagePx - sizePx / 2) * mPerPx;
  const planeZ = -(projectInImagePy - sizePx / 2) * mPerPx;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, sizeM, planeX, planeZ };
}

export default function MassingContextScene(props: ContextSceneProps) {
  const {
    plot, volumes, floorHeight, edgeColors,
    latitude, longitude, northHeadingDeg, buildingYOffsetM = 0,
    contextRadiusM = 350,
    nearbyHeightOverrides = {},
    nearbyHidden = [],
    onSetHeight, onToggleHide,
  } = props;

  const bbox = useMemo(() => polygonBBox(plot), [plot]);
  const maxDim = Math.max(bbox.w, bbox.h, ...volumes.map((v) => v.toY), 30);
  const camDist = Math.max(contextRadiusM * 1.4, maxDim * 1.5);
  const headingRad = (northHeadingDeg * Math.PI) / 180;

  const [ground, setGround] = useState<ContextGround | null>(null);
  const [groundError, setGroundError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGround(null);
    setGroundError(null);
    loadEsriContext(latitude, longitude, contextRadiusM)
      .then((g) => { if (!cancelled) setGround(g); })
      .catch((e: Error) => { if (!cancelled) setGroundError(e.message); });
    return () => { cancelled = true; };
  }, [latitude, longitude, contextRadiusM]);

  const [osmBuildings, setOsmBuildings] = useState<OsmBuilding[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function fetchOSM() {
      try {
        const radius = Math.round(contextRadiusM);
        const query = `[out:json][timeout:25];way[building](around:${radius},${latitude},${longitude});(._;>;);out;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`OSM fetch ${res.status}`);
        const data = (await res.json()) as { elements: OsmElement[] };
        if (cancelled) return;
        setOsmBuildings(parseOsm(data.elements, latitude, longitude));
      } catch {
        if (!cancelled) setOsmBuildings([]);
      }
    }
    fetchOSM();
    return () => { cancelled = true; };
  }, [latitude, longitude, contextRadiusM]);

  const hidden = useMemo(() => new Set(nearbyHidden), [nearbyHidden]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = osmBuildings.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="relative w-full h-full">
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
        onPointerMissed={() => setSelectedId(null)}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[300, 500, 200]} intensity={0.85} castShadow />

        {ground && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ground.planeX, 0, ground.planeZ]} receiveShadow>
            <planeGeometry args={[ground.sizeM, ground.sizeM]} />
            <meshStandardMaterial map={ground.texture} roughness={1} metalness={0} />
          </mesh>
        )}

        {/* Surrounding white volumes */}
        {osmBuildings.map((b) => {
          if (hidden.has(b.id)) return null;
          const h = nearbyHeightOverrides[b.id] ?? b.defaultHeight;
          return (
            <OsmBuildingMesh
              key={b.id}
              polygon={b.polygon}
              height={h}
              isSelected={selectedId === b.id}
              onSelect={() => setSelectedId(b.id)}
            />
          );
        })}

        {/* Project building */}
        <group rotation={[0, -headingRad, 0]} position={[0, buildingYOffsetM, 0]}>
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

      {!ground && !groundError && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-white/85 text-[10.5px] uppercase tracking-[0.10em] text-ink-700 border border-ink-200">
          Loading satellite tiles…
        </div>
      )}
      {groundError && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-red-50 text-[10.5px] text-red-800 border border-red-200">
          Could not load tiles: {groundError}
        </div>
      )}

      {/* Status badge: count + 'click a building to edit' */}
      <div className="absolute top-2 left-2 px-2 py-1 bg-white/85 text-[10.5px] text-ink-700 border border-ink-200" style={{ display: ground && !selected ? "block" : "none" }}>
        {osmBuildings.length} surrounding buildings · click any to edit its height
      </div>

      {/* Selection editor */}
      {selected && (
        <div className="absolute top-2 left-2 max-w-[280px] bg-white/95 border border-ink-200 shadow-md p-3 grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow text-ink-500">Selected · OSM {selected.id.replace(/^osm-/, "")}</span>
            <button
              className="text-ink-400 hover:text-ink-700 text-[14px] leading-none"
              onClick={() => setSelectedId(null)}
              title="Deselect"
            >×</button>
          </div>
          <label className="grid gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Height (m)</span>
            <input
              type="number"
              step={0.5}
              min={0}
              className="cell-input text-right"
              value={Number((nearbyHeightOverrides[selected.id] ?? selected.defaultHeight).toFixed(1))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n >= 0 && onSetHeight) onSetHeight(selected.id, n);
              }}
            />
          </label>
          <div className="text-[10.5px] text-ink-500">
            OSM default: {selected.defaultHeight.toFixed(1)} m
            {nearbyHeightOverrides[selected.id] !== undefined && (
              <button
                className="ml-2 text-qube-700 hover:text-qube-900 underline"
                onClick={() => onSetHeight?.(selected.id, selected.defaultHeight)}
              >reset</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary btn-xs"
              onClick={() => onToggleHide?.(selected.id, !hidden.has(selected.id))}
            >
              {hidden.has(selected.id) ? "Show" : "Hide"}
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-white/85 text-[9px] text-ink-700 border border-ink-200">
        © Esri · Maxar · Earthstar Geographics · GIS User Community · Buildings © OpenStreetMap
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function OsmBuildingMesh({
  polygon, height, isSelected, onSelect,
}: { polygon: Point[]; height: number; isSelected: boolean; onSelect: () => void }) {
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
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
      castShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
      <meshStandardMaterial
        color={isSelected ? "#fdf6e3" : "#f3f1ec"}
        roughness={0.85}
        metalness={0.05}
        emissive={isSelected ? new THREE.Color("#a17e4c") : new THREE.Color("#000000")}
        emissiveIntensity={isSelected ? 0.18 : 0}
      />
      <Edges color={isSelected ? "#a17e4c" : "#aeada6"} threshold={1} />
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

interface OsmNode { type: "node"; id: number; lat: number; lon: number; }
interface OsmWay { type: "way"; id: number; nodes: number[]; tags?: Record<string, string>; }
type OsmElement = OsmNode | OsmWay;

function parseOsm(elements: OsmElement[], originLat: number, originLng: number): OsmBuilding[] {
  const nodeMap = new Map<number, OsmNode>();
  for (const el of elements) if (el.type === "node") nodeMap.set(el.id, el);
  const buildings: OsmBuilding[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.tags?.building) continue;
    const polygon: Point[] = [];
    for (const nid of el.nodes) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      const xy = latLngToLocalXY(n.lat, n.lon, originLat, originLng);
      polygon.push({ x: xy.x, y: xy.y });
    }
    if (polygon.length >= 2) {
      const a = polygon[0];
      const b = polygon[polygon.length - 1];
      if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) polygon.pop();
    }
    if (polygon.length < 3) continue;
    const tags = el.tags;
    let height = 0;
    if (tags["height"]) {
      const n = parseFloat(tags["height"]);
      if (Number.isFinite(n)) height = n;
    }
    if (height <= 0 && tags["building:levels"]) {
      const lv = parseFloat(tags["building:levels"]);
      if (Number.isFinite(lv)) height = lv * 3.2;
    }
    if (height <= 0) height = 9;
    buildings.push({
      id: `osm-${el.id}`,
      polygon,
      defaultHeight: height,
      name: tags["name"],
    });
  }
  return buildings;
}
