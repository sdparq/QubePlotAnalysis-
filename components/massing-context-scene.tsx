"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges, Line, TransformControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Point } from "@/lib/geom";
import { polygonBBox } from "@/lib/geom";
import type { Volume } from "@/lib/massing";
import type { CustomNeighbor } from "@/lib/types";
import { renderSchemeWithGemini, DEFAULT_SCHEME_PROMPT } from "@/lib/ai-render";

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
  /** Y offset (m) applied to the project building. Useful to push it up/down for fine alignment with the basemap. */
  buildingYOffsetM?: number;
  /** XZ offset (m) applied to the project building so it lands exactly on its plot in the basemap. */
  buildingXOffsetM?: number;
  buildingZOffsetM?: number;
  /** Half-side of the basemap footprint in metres. Auto-picks zoom. */
  contextRadiusM?: number;
  /** OSM way id → custom height (m). Replaces OSM-derived default. */
  nearbyHeightOverrides?: Record<string, number>;
  /** OSM way ids hidden from the scene */
  nearbyHidden?: string[];
  /** Map style to use for the basemap */
  mapStyle?: "topo" | "satellite" | "schematic";
  /** User-defined extra neighbours */
  customNeighbors?: CustomNeighbor[];
  /** Persist user edits */
  onSetHeight?: (osmId: string, height: number) => void;
  onToggleHide?: (osmId: string, hide: boolean) => void;
  onSetMapStyle?: (style: "topo" | "satellite" | "schematic") => void;
  onSetBuildingOffset?: (x: number, z: number) => void;
  onAddCustomNeighbor?: (centerX: number, centerZ: number) => string;
  onUpdateCustomNeighbor?: (id: string, partial: Partial<CustomNeighbor>) => void;
  onDeleteCustomNeighbor?: (id: string) => void;
  onDuplicateCustomNeighbor?: (id: string) => string;
  /** Randomise tower heights and positions across all neighbours. */
  onShuffleTowers?: (minH: number, maxH: number) => void;
}

type MapStyle = "topo" | "satellite" | "schematic";

function tileUrl(style: MapStyle, z: number, x: number, y: number): string {
  if (style === "satellite") {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  if (style === "schematic") {
    return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
  }
  // topo
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
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

async function loadContextTiles(lat: number, lon: number, contextRadiusM: number, style: MapStyle): Promise<ContextGround> {
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
  // Off-white fill in case any tile fails to load (for cleaner schematic look)
  ctx.fillStyle = style === "schematic" ? "#f5f4ee" : "#dadcd8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tasks: Promise<void>[] = [];
  for (let dy = 0; dy < grid; dy++) {
    for (let dx = 0; dx < grid; dx++) {
      const tx = startTileX + dx;
      const ty = startTileY + dy;
      const url = tileUrl(style, z, tx, ty);
      tasks.push(
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            ctx.drawImage(img, dx * TILE_PX, dy * TILE_PX);
            resolve();
          };
          img.onerror = () => {
            // Resolve anyway; a missing tile leaves the fill colour, which is acceptable for a schematic look.
            resolve();
          };
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
    buildingXOffsetM = 0, buildingZOffsetM = 0,
    contextRadiusM = 350,
    nearbyHeightOverrides = {},
    nearbyHidden = [],
    mapStyle = "topo",
    customNeighbors = [],
    onSetHeight, onToggleHide, onSetMapStyle, onSetBuildingOffset,
    onAddCustomNeighbor, onUpdateCustomNeighbor, onDeleteCustomNeighbor, onDuplicateCustomNeighbor,
    onShuffleTowers,
  } = props;
  const [placeMode, setPlaceMode] = useState(false);
  const [addNeighbourMode, setAddNeighbourMode] = useState(false);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">("translate");
  const [isDragging, setIsDragging] = useState(false);
  const [neighborObjects, setNeighborObjects] = useState<Map<string, THREE.Group>>(new Map());
  const [shuffleMinH, setShuffleMinH] = useState(25);
  const [shuffleMaxH, setShuffleMaxH] = useState(110);

  // ---- AI render (Option B: Gemini image-to-image) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const [apiKey, setApiKey] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("qube.gemini.apiKey");
    if (saved) setApiKey(saved);
  }, []);
  const [keyDialog, setKeyDialog] = useState<{ open: boolean; draft: string }>({ open: false, draft: "" });
  const [aiRendering, setAiRendering] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ imageDataUrl: string; note?: string; modelUsed?: string } | null>(null);

  const persistKey = useCallback((k: string) => {
    setApiKey(k);
    try { window.localStorage.setItem("qube.gemini.apiKey", k); } catch {}
  }, []);

  const captureCanvasPng = useCallback((): string | null => {
    const c = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!c) return null;
    try { return c.toDataURL("image/png"); } catch { return null; }
  }, []);

  const handleGeminiRender = useCallback(async () => {
    if (!apiKey) {
      setKeyDialog({ open: true, draft: "" });
      return;
    }
    const png = captureCanvasPng();
    if (!png) { setAiError("Could not capture the viewer canvas."); return; }
    setAiRendering(true);
    setAiError(null);
    try {
      const out = await renderSchemeWithGemini(apiKey, png, DEFAULT_SCHEME_PROMPT);
      setAiResult({ imageDataUrl: out.imageDataUrl, note: out.textNote, modelUsed: out.modelUsed });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiRendering(false);
    }
  }, [apiKey, captureCanvasPng]);

  const registerNeighborRef = useCallback((id: string, g: THREE.Group | null) => {
    setNeighborObjects((prev) => {
      const next = new Map(prev);
      if (g) next.set(id, g);
      else next.delete(id);
      return next;
    });
  }, []);

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
    loadContextTiles(latitude, longitude, contextRadiusM, mapStyle)
      .then((g) => { if (!cancelled) setGround(g); })
      .catch((e: Error) => { if (!cancelled) setGroundError(e.message); });
    return () => { cancelled = true; };
  }, [latitude, longitude, contextRadiusM, mapStyle]);

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
  type Selection = { kind: "osm"; id: string } | { kind: "custom"; id: string } | null;
  const [selection, setSelection] = useState<Selection>(null);
  const selectedOsm =
    selection?.kind === "osm" ? osmBuildings.find((b) => b.id === selection.id) ?? null : null;
  const selectedCustom =
    selection?.kind === "custom" ? customNeighbors.find((n) => n.id === selection.id) ?? null : null;
  const selectedObject =
    selection?.kind === "custom" ? neighborObjects.get(selection.id) ?? null : null;

  const commitTransform = useCallback(() => {
    if (selection?.kind !== "custom" || !onUpdateCustomNeighbor) return;
    const obj = neighborObjects.get(selection.id);
    if (!obj) return;
    onUpdateCustomNeighbor(selection.id, {
      centerX: Number(obj.position.x.toFixed(2)),
      centerZ: Number(obj.position.z.toFixed(2)),
      rotationDeg: Number(((obj.rotation.y * 180) / Math.PI).toFixed(1)),
    });
  }, [selection, neighborObjects, onUpdateCustomNeighbor]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <Canvas
        shadows
        orthographic
        camera={{
          position: [camDist * 0.85, camDist * 0.7, camDist],
          near: 0.1,
          far: maxDim * 400,
          zoom: 1,
        }}
        gl={{ preserveDrawingBuffer: true }}
        style={{ background: "#bccbd6" }}
        dpr={[1, 2]}
        onPointerMissed={() => setSelection(null)}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[300, 500, 200]} intensity={0.85} castShadow />

        {ground && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[ground.planeX, 0, ground.planeZ]}
            receiveShadow
            onClick={(e) => {
              if (placeMode && onSetBuildingOffset) {
                e.stopPropagation();
                onSetBuildingOffset(e.point.x, e.point.z);
                setPlaceMode(false);
                return;
              }
              if (addNeighbourMode && onAddCustomNeighbor) {
                e.stopPropagation();
                const newId = onAddCustomNeighbor(e.point.x, e.point.z);
                setAddNeighbourMode(false);
                setSelection({ kind: "custom", id: newId });
                return;
              }
            }}
          >
            <planeGeometry args={[ground.sizeM, ground.sizeM]} />
            <meshStandardMaterial map={ground.texture} roughness={1} metalness={0} />
          </mesh>
        )}

        {/* Surrounding white volumes from OSM */}
        {osmBuildings.map((b) => {
          if (hidden.has(b.id)) return null;
          const h = nearbyHeightOverrides[b.id] ?? b.defaultHeight;
          return (
            <OsmBuildingMesh
              key={b.id}
              polygon={b.polygon}
              height={h}
              isSelected={selection?.kind === "osm" && selection.id === b.id}
              onSelect={() => setSelection({ kind: "osm", id: b.id })}
            />
          );
        })}

        {/* Manually defined neighbours */}
        {customNeighbors.map((n) => (
          <CustomNeighborMesh
            key={n.id}
            neighbor={n}
            isSelected={selection?.kind === "custom" && selection.id === n.id}
            onSelect={() => setSelection({ kind: "custom", id: n.id })}
            registerRef={registerNeighborRef}
          />
        ))}

        {selectedObject && (
          <TransformControls
            object={selectedObject}
            mode={transformMode}
            showX={transformMode === "translate"}
            showY={transformMode === "rotate"}
            showZ={transformMode === "translate"}
            size={0.9}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => {
              setIsDragging(false);
              commitTransform();
            }}
          />
        )}

        {/* Project building */}
        <group
          rotation={[0, -headingRad, 0]}
          position={[buildingXOffsetM, buildingYOffsetM, buildingZOffsetM]}
        >
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
          enabled={!isDragging}
          enablePan
          enableZoom
          enableRotate
          target={[0, maxDim / 4, 0]}
          maxPolarAngle={Math.PI / 2 - 0.02}
          minZoom={0.15}
          maxZoom={20}
        />
      </Canvas>

      {!ground && !groundError && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-white/85 text-[10.5px] uppercase tracking-[0.10em] text-ink-700 border border-ink-200">
          Loading basemap tiles…
        </div>
      )}
      {groundError && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-red-50 text-[10.5px] text-red-800 border border-red-200">
          Could not load tiles: {groundError}
        </div>
      )}

      {/* Map style + position controls (top-left, only when no building is selected) */}
      {!selectedOsm && !selectedCustom && ground && (
        <div className="absolute top-2 left-2 grid gap-2 max-w-[260px]">
          <div className="inline-flex border border-ink-200 bg-white/95 shadow-sm">
            {(["topo", "satellite", "schematic"] as MapStyle[]).map((s) => (
              <button
                key={s}
                onClick={() => onSetMapStyle?.(s)}
                className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
                  mapStyle === s ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-50"
                }`}
              >{s === "topo" ? "Topo" : s === "satellite" ? "Satellite" : "Schematic"}</button>
            ))}
          </div>

          {onSetBuildingOffset && (
            <div className="bg-white/95 border border-ink-200 shadow-sm p-2 grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="eyebrow text-ink-500 text-[10px]">Building position</span>
                <button
                  className={`px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.10em] transition-colors ${
                    placeMode ? "bg-qube-500 text-white" : "border border-ink-300 text-ink-700 hover:bg-bone-50"
                  }`}
                  onClick={() => setPlaceMode((p) => !p)}
                >{placeMode ? "Click on map…" : "Click to place"}</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="grid gap-0.5">
                  <span className="text-[9px] uppercase tracking-[0.10em] text-ink-500">X (m)</span>
                  <input
                    type="number"
                    step={0.5}
                    className="cell-input text-right !py-1 !px-1.5 !text-[11px]"
                    value={buildingXOffsetM.toFixed(1)}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n)) onSetBuildingOffset(n, buildingZOffsetM);
                    }}
                  />
                </label>
                <label className="grid gap-0.5">
                  <span className="text-[9px] uppercase tracking-[0.10em] text-ink-500">Z (m)</span>
                  <input
                    type="number"
                    step={0.5}
                    className="cell-input text-right !py-1 !px-1.5 !text-[11px]"
                    value={buildingZOffsetM.toFixed(1)}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n)) onSetBuildingOffset(buildingXOffsetM, n);
                    }}
                  />
                </label>
              </div>
              {(buildingXOffsetM !== 0 || buildingZOffsetM !== 0) && (
                <button
                  className="text-[10px] text-qube-700 hover:text-qube-900 underline justify-self-start"
                  onClick={() => onSetBuildingOffset(0, 0)}
                >Reset to lat/lon</button>
              )}
            </div>
          )}

          <div className="px-2 py-1 bg-white/85 text-[10px] text-ink-700 border border-ink-200">
            {osmBuildings.length + customNeighbors.length} surrounding buildings · click any to edit
          </div>
          {onAddCustomNeighbor && (
            <button
              className={`px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.10em] transition-colors ${
                addNeighbourMode ? "bg-qube-500 text-white" : "border border-ink-300 bg-white/95 text-ink-800 hover:bg-bone-50"
              }`}
              onClick={() => setAddNeighbourMode((p) => !p)}
            >
              {addNeighbourMode ? "Click on map to place…" : "+ Add neighbour"}
            </button>
          )}

          <div className="bg-white/95 border border-ink-200 shadow-sm p-2 grid gap-1.5">
            <span className="eyebrow text-ink-500 text-[10px]">AI scheme render</span>
            <button
              className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50 disabled:cursor-wait transition-colors"
              onClick={handleGeminiRender}
              disabled={aiRendering}
              title="Capture the viewer and re-render it via Google Gemini. Free tier from aistudio.google.com."
            >
              {aiRendering ? "Rendering…" : "✦ Render scheme"}
            </button>
            <button
              className="text-[10px] text-ink-500 hover:text-ink-900 underline justify-self-start"
              onClick={() => setKeyDialog({ open: true, draft: apiKey })}
            >
              {apiKey ? "Replace Gemini key" : "Set Gemini key"}
            </button>
            {aiError && (
              <div className="text-[10px] text-red-700 leading-snug max-w-[260px] whitespace-pre-wrap">{aiError}</div>
            )}
          </div>
          {onShuffleTowers && customNeighbors.some((n) => n.tower) && (
            <div className="bg-white/95 border border-ink-200 shadow-sm p-2 grid gap-1.5">
              <span className="eyebrow text-ink-500 text-[10px]">Shuffle towers</span>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="grid gap-0.5">
                  <span className="text-[9px] uppercase tracking-[0.10em] text-ink-500">Min H (m)</span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    className="cell-input text-right !py-1 !px-1.5 !text-[11px]"
                    value={shuffleMinH}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setShuffleMinH(n);
                    }}
                  />
                </label>
                <label className="grid gap-0.5">
                  <span className="text-[9px] uppercase tracking-[0.10em] text-ink-500">Max H (m)</span>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    className="cell-input text-right !py-1 !px-1.5 !text-[11px]"
                    value={shuffleMaxH}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setShuffleMaxH(n);
                    }}
                  />
                </label>
              </div>
              <button
                className="px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.10em] border border-ink-300 bg-white text-ink-800 hover:bg-bone-50 transition-colors"
                onClick={() => {
                  const lo = Math.min(shuffleMinH, shuffleMaxH);
                  const hi = Math.max(shuffleMinH, shuffleMaxH);
                  onShuffleTowers(lo, hi);
                }}
                title="Randomise tower heights and offsets within their podiums"
              >
                ⤲ Shuffle towers
              </button>
            </div>
          )}
        </div>
      )}

      {/* OSM-building editor */}
      {selectedOsm && (
        <div className="absolute top-2 left-2 max-w-[280px] bg-white/95 border border-ink-200 shadow-md p-3 grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow text-ink-500">OSM · {selectedOsm.id.replace(/^osm-/, "")}</span>
            <button
              className="text-ink-400 hover:text-ink-700 text-[14px] leading-none"
              onClick={() => setSelection(null)}
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
              value={Number((nearbyHeightOverrides[selectedOsm.id] ?? selectedOsm.defaultHeight).toFixed(1))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n >= 0 && onSetHeight) onSetHeight(selectedOsm.id, n);
              }}
            />
          </label>
          <div className="text-[10.5px] text-ink-500">
            OSM default: {selectedOsm.defaultHeight.toFixed(1)} m
            {nearbyHeightOverrides[selectedOsm.id] !== undefined && (
              <button
                className="ml-2 text-qube-700 hover:text-qube-900 underline"
                onClick={() => onSetHeight?.(selectedOsm.id, selectedOsm.defaultHeight)}
              >reset</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-secondary btn-xs"
              onClick={() => onToggleHide?.(selectedOsm.id, !hidden.has(selectedOsm.id))}
            >
              {hidden.has(selectedOsm.id) ? "Show" : "Hide"}
            </button>
          </div>
        </div>
      )}

      {/* Custom-neighbour editor */}
      {selectedCustom && onUpdateCustomNeighbor && onDeleteCustomNeighbor && (
        <div className="absolute top-2 left-2 max-w-[300px] bg-white/95 border border-ink-200 shadow-md p-3 grid gap-2 max-h-[calc(100%-1rem)] overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow text-ink-500">Custom · {selectedCustom.id.replace(/^cn-/, "")}</span>
            <button
              className="text-ink-400 hover:text-ink-700 text-[14px] leading-none"
              onClick={() => setSelection(null)}
              title="Deselect"
            >×</button>
          </div>
          <div className="inline-flex border border-ink-200 bg-bone-50 self-start">
            {(["translate", "rotate"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTransformMode(m)}
                className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
                  transformMode === m ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-200"
                }`}
                title={m === "translate" ? "Drag the gizmo arrows to move" : "Drag the gizmo ring to rotate"}
              >{m === "translate" ? "Move" : "Rotate"}</button>
            ))}
          </div>
          <p className="text-[10.5px] text-ink-500 leading-snug">
            Drag the on-screen gizmo to {transformMode === "translate" ? "move" : "rotate"} this neighbour, or
            edit the numbers below.
          </p>
          <label className="grid gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Name</span>
            <input
              className="cell-input"
              placeholder="optional"
              value={selectedCustom.name ?? ""}
              onChange={(e) => onUpdateCustomNeighbor(selectedCustom.id, { name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            <NumField label="X" value={selectedCustom.centerX} step={0.5}
              onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { centerX: v })} />
            <NumField label="Z" value={selectedCustom.centerZ} step={0.5}
              onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { centerZ: v })} />
            <NumField label="Rot°" value={selectedCustom.rotationDeg} step={5}
              onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { rotationDeg: v })} />
          </div>
          <div className="border-t border-ink-100 pt-2">
            <div className="eyebrow text-ink-500 text-[10px] mb-1">Podium</div>
            <div className="grid grid-cols-3 gap-1.5">
              <NumField label="W" value={selectedCustom.widthM} step={1} min={1}
                onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { widthM: Math.max(1, v) })} />
              <NumField label="D" value={selectedCustom.depthM} step={1} min={1}
                onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { depthM: Math.max(1, v) })} />
              <NumField label="H" value={selectedCustom.heightM} step={0.5} min={1}
                onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { heightM: Math.max(1, v) })} />
            </div>
          </div>
          <div className="border-t border-ink-100 pt-2">
            <div className="eyebrow text-ink-500 text-[10px] mb-1 flex items-center justify-between">
              <span>Tower {selectedCustom.tower ? "" : "(none)"}</span>
              {selectedCustom.tower ? (
                <button
                  className="text-[10px] text-red-700 hover:text-red-900 underline"
                  onClick={() => onUpdateCustomNeighbor(selectedCustom.id, { tower: undefined })}
                >Remove</button>
              ) : (
                <button
                  className="text-[10px] text-qube-700 hover:text-qube-900 underline"
                  onClick={() => onUpdateCustomNeighbor(selectedCustom.id, { tower: {
                    widthM: Math.max(8, selectedCustom.widthM * 0.45),
                    depthM: Math.max(8, selectedCustom.depthM * 0.45),
                    heightM: 30,
                    offsetXM: 0,
                    offsetZM: 0,
                  }})}
                >Add tower</button>
              )}
            </div>
            {selectedCustom.tower && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  <NumField label="W" value={selectedCustom.tower.widthM} step={1} min={1}
                    onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { tower: { ...selectedCustom.tower!, widthM: Math.max(1, v) } })} />
                  <NumField label="D" value={selectedCustom.tower.depthM} step={1} min={1}
                    onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { tower: { ...selectedCustom.tower!, depthM: Math.max(1, v) } })} />
                  <NumField label="H" value={selectedCustom.tower.heightM} step={0.5} min={1}
                    onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { tower: { ...selectedCustom.tower!, heightM: Math.max(1, v) } })} />
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  <NumField label="Offset X" value={selectedCustom.tower.offsetXM ?? 0} step={0.5}
                    onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { tower: { ...selectedCustom.tower!, offsetXM: v } })} />
                  <NumField label="Offset Z" value={selectedCustom.tower.offsetZM ?? 0} step={0.5}
                    onChange={(v) => onUpdateCustomNeighbor(selectedCustom.id, { tower: { ...selectedCustom.tower!, offsetZM: v } })} />
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onDuplicateCustomNeighbor && (
              <button
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  const newId = onDuplicateCustomNeighbor(selectedCustom.id);
                  setSelection({ kind: "custom", id: newId });
                }}
                title="Create a copy of this neighbour 8 m east"
              >Duplicate</button>
            )}
            <button
              className="btn btn-danger btn-xs"
              onClick={() => {
                if (confirm("Delete this neighbour?")) {
                  onDeleteCustomNeighbor(selectedCustom.id);
                  setSelection(null);
                }
              }}
            >Delete</button>
          </div>
        </div>
      )}

      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-white/85 text-[9px] text-ink-700 border border-ink-200">
        © Esri · Maxar · Earthstar Geographics · GIS User Community · Buildings © OpenStreetMap · Render via Google Gemini
      </div>

      {/* API key dialog */}
      {keyDialog.open && (
        <div className="absolute inset-0 z-30 bg-ink-900/55 flex items-center justify-center p-4">
          <div className="bg-white border border-ink-200 shadow-lg max-w-[440px] w-full p-4 grid gap-3">
            <div>
              <div className="eyebrow text-ink-500">Google AI Studio</div>
              <h3 className="text-[15px] font-medium text-ink-900 mt-1">Gemini API key</h3>
              <p className="text-[11.5px] text-ink-500 mt-1 leading-snug">
                Get a free key at{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-qube-700 hover:text-qube-900 underline"
                >aistudio.google.com/app/apikey</a>{" "}
                (free tier includes image generation, ~10 req/min). Make sure
                you create the key from <strong>AI Studio</strong>, not Google
                Cloud Console — those keys don&apos;t include image gen on the
                free tier. Stored only in your browser.
              </p>
            </div>
            <input
              type="password"
              autoFocus
              spellCheck={false}
              className="cell-input"
              placeholder="AIza…"
              value={keyDialog.draft}
              onChange={(e) => setKeyDialog((s) => ({ ...s, draft: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && keyDialog.draft.trim()) {
                  persistKey(keyDialog.draft.trim());
                  setKeyDialog({ open: false, draft: "" });
                }
              }}
            />
            <div className="flex items-center justify-end gap-2">
              {apiKey && (
                <button
                  className="text-[11px] text-red-700 hover:text-red-900 underline mr-auto"
                  onClick={() => {
                    persistKey("");
                    setKeyDialog({ open: false, draft: "" });
                  }}
                >Forget key</button>
              )}
              <button
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.10em] border border-ink-300 text-ink-700 hover:bg-bone-50"
                onClick={() => setKeyDialog({ open: false, draft: "" })}
              >Cancel</button>
              <button
                className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50"
                disabled={!keyDialog.draft.trim()}
                onClick={() => {
                  persistKey(keyDialog.draft.trim());
                  setKeyDialog({ open: false, draft: "" });
                }}
              >Save</button>
            </div>
          </div>
        </div>
      )}

      {/* AI render result modal */}
      {aiResult && (
        <div className="absolute inset-0 z-30 bg-ink-900/65 flex items-center justify-center p-4">
          <div className="bg-white border border-ink-200 shadow-lg max-w-[1100px] w-full max-h-full overflow-auto grid gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow text-ink-500">AI scheme render</div>
                <h3 className="text-[15px] font-medium text-ink-900 mt-1">Gemini output</h3>
                {aiResult.modelUsed && (
                  <p className="text-[10.5px] text-ink-500 mt-0.5">model: {aiResult.modelUsed}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  download="qube-scheme.png"
                  href={aiResult.imageDataUrl}
                  className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] border border-ink-300 text-ink-800 hover:bg-bone-50"
                >Download PNG</a>
                <button
                  className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50"
                  disabled={aiRendering}
                  onClick={handleGeminiRender}
                >Re-render</button>
                <button
                  className="text-ink-400 hover:text-ink-700 text-[18px] leading-none px-2"
                  onClick={() => setAiResult(null)}
                  title="Close"
                >×</button>
              </div>
            </div>
            <div className="border border-ink-200 bg-bone-50 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={aiResult.imageDataUrl} alt="AI scheme render" className="max-w-full h-auto" />
            </div>
            {aiResult.note && (
              <p className="text-[11px] text-ink-500 leading-snug whitespace-pre-wrap">{aiResult.note}</p>
            )}
          </div>
        </div>
      )}

      {aiRendering && !aiResult && (
        <div className="absolute inset-0 z-20 bg-ink-900/35 flex items-center justify-center pointer-events-none">
          <div className="bg-white px-4 py-3 border border-ink-200 shadow-md text-[12px] text-ink-700 grid gap-2 justify-items-center">
            <div className="w-6 h-6 border-2 border-qube-500 border-t-transparent rounded-full animate-spin" />
            <span>Rendering with Gemini…</span>
          </div>
        </div>
      )}
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

function CustomNeighborMesh({
  neighbor, isSelected, onSelect, registerRef,
}: {
  neighbor: CustomNeighbor;
  isSelected: boolean;
  onSelect: () => void;
  registerRef: (id: string, g: THREE.Group | null) => void;
}) {
  const { widthM, depthM, heightM, tower } = neighbor;
  const groupRef = useRef<THREE.Group>(null);

  // Register / unregister the group so the parent can attach TransformControls.
  useEffect(() => {
    registerRef(neighbor.id, groupRef.current);
    return () => registerRef(neighbor.id, null);
  }, [neighbor.id, registerRef]);

  // Apply position / rotation imperatively so TransformControls can mutate
  // the same Object3D without conflicting with declarative JSX props.
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(neighbor.centerX, 0, neighbor.centerZ);
    groupRef.current.rotation.y = (neighbor.rotationDeg * Math.PI) / 180;
  }, [neighbor.centerX, neighbor.centerZ, neighbor.rotationDeg]);

  const baseColor = isSelected ? "#fdf6e3" : "#f3f1ec";
  const edgeColorStr = isSelected ? "#a17e4c" : "#aeada6";
  const emissive = isSelected ? new THREE.Color("#a17e4c") : new THREE.Color("#000000");

  return (
    <group ref={groupRef}>
      <mesh
        position={[0, heightM / 2, 0]}
        castShadow
        receiveShadow
        onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <boxGeometry args={[widthM, heightM, depthM]} />
        <meshStandardMaterial color={baseColor} roughness={0.85} metalness={0.05} emissive={emissive} emissiveIntensity={isSelected ? 0.18 : 0} />
        <Edges color={edgeColorStr} threshold={1} />
      </mesh>
      {tower && (
        <mesh
          position={[tower.offsetXM ?? 0, heightM + tower.heightM / 2, tower.offsetZM ?? 0]}
          castShadow
          receiveShadow
          onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
        >
          <boxGeometry args={[tower.widthM, tower.heightM, tower.depthM]} />
          <meshStandardMaterial color={baseColor} roughness={0.85} metalness={0.05} emissive={emissive} emissiveIntensity={isSelected ? 0.18 : 0} />
          <Edges color={edgeColorStr} threshold={1} />
        </mesh>
      )}
    </group>
  );
}

function NumField({
  label, value, onChange, step = 1, min,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="grid gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        className="cell-input text-right !py-1 !px-1.5 !text-[11px]"
        value={Number.isFinite(value) ? Number(value.toFixed(1)) : 0}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
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

