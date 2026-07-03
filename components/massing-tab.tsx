"use client";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt2 } from "@/lib/format";
import PlanTrace from "./plan-trace";
import {
  type Point,
  edgeLengths,
  offsetPolygon,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  rectanglePlotPolygon,
  translatePolygon,
} from "@/lib/geom";
import { edgeColor } from "@/lib/edge-colors";
import type { Volume } from "@/lib/massing";

const MassingScene = dynamic(() => import("./massing-scene"), {
  ssr: false,
  loading: () => (
    <div className="aspect-[4/3] border border-ink-200 bg-bone-100 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-ink-500 uppercase tracking-[0.18em]">Loading 3D viewer…</div>
      </div>
    </div>
  ),
});

const MassingContextScene = dynamic(() => import("./massing-context-scene"), {
  ssr: false,
  loading: () => (
    <div className="aspect-[4/3] border border-ink-200 bg-bone-100 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-ink-500 uppercase tracking-[0.18em]">Loading 3D Tiles…</div>
      </div>
    </div>
  ),
});

/** Resolve a per-edge setback array for a tier:
 *   - if the persisted perEdge array matches the plot polygon length, use it
 *   - otherwise fall back to the uniform value on every edge */
function resolvePerEdge(plot: Point[], uniform: number, perEdge: number[] | undefined): number[] {
  if (perEdge && perEdge.length === plot.length) {
    return perEdge.map((v) => Math.max(0, v));
  }
  return plot.map(() => Math.max(0, uniform));
}

function tierPolygon(plot: Point[], setbacks: number[]): Point[] {
  if (plot.length < 3) return plot;
  if (setbacks.every((s) => s <= 0)) return plot;
  return offsetPolygon(plot, setbacks);
}

export default function MassingTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);

  const mode = project.plotMode === "polygon" ? "polygon" : "rectangular";

  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;

  const plotPoly: Point[] = useMemo(() => {
    if (mode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
      return project.plotPolygon;
    }
    return rectanglePlotPolygon(frontage, depth);
  }, [mode, project.plotPolygon, frontage, depth]);

  // Per-tier setbacks. Each tier has a uniform fallback and an optional per-edge
  // override. The user edits the per-edge values in the table below.
  const groundUni = project.groundSetbackM ?? 3;
  const podiumUni = project.podiumSetbackM ?? 3;
  const towerUni = project.towerSetbackM ?? 6;

  const groundEdges = useMemo(
    () => resolvePerEdge(plotPoly, groundUni, project.groundSetbackPerEdge),
    [plotPoly, groundUni, project.groundSetbackPerEdge],
  );
  const podiumEdges = useMemo(
    () => resolvePerEdge(plotPoly, podiumUni, project.podiumSetbackPerEdge),
    [plotPoly, podiumUni, project.podiumSetbackPerEdge],
  );
  const towerEdges = useMemo(
    () => resolvePerEdge(plotPoly, towerUni, project.towerSetbackPerEdge),
    [plotPoly, towerUni, project.towerSetbackPerEdge],
  );

  const groundPoly = useMemo(() => tierPolygon(plotPoly, groundEdges), [plotPoly, groundEdges]);
  const podiumPoly = useMemo(() => tierPolygon(plotPoly, podiumEdges), [plotPoly, podiumEdges]);
  const towerPolyCentered = useMemo(() => tierPolygon(plotPoly, towerEdges), [plotPoly, towerEdges]);

  const towerDx = project.towerOffsetXM ?? 0;
  const towerDy = project.towerOffsetYM ?? 0;
  const towerPoly = useMemo(
    () => (towerDx === 0 && towerDy === 0 ? towerPolyCentered : translatePolygon(towerPolyCentered, towerDx, towerDy)),
    [towerPolyCentered, towerDx, towerDy],
  );

  const edgeColors = useMemo(
    () => (mode === "polygon" ? plotPoly.map((_, i) => edgeColor(i)) : undefined),
    [mode, plotPoly],
  );

  const plotPolyArea = polygonArea(plotPoly);
  const groundArea = polygonArea(groundPoly);
  const podiumArea = polygonArea(podiumPoly);
  const towerArea = polygonArea(towerPoly);

  // Tier heights — mirror the same fallbacks the Setup floor-breakdown card uses
  // so unsaved defaults still render here. Ground in particular defaults to
  // 1 × 4.5 m even when project.ground is undefined.
  const basementCount = project.basements?.count ?? 0;
  const basementHeightM = project.basements?.heightM ?? 3.0;
  const basementH = Math.max(0, basementCount) * Math.max(0, basementHeightM);

  const groundCount = project.ground?.count ?? 1;
  const groundHeightM = project.ground?.heightM ?? 4.5;
  const groundH = Math.max(0, groundCount) * Math.max(0, groundHeightM);

  const podiumCount = project.podium?.count ?? 0;
  const podiumHeightM = project.podium?.heightM ?? 4.0;
  const podiumH = Math.max(0, podiumCount) * Math.max(0, podiumHeightM);

  const towerCount = project.typeFloors?.count ?? project.numFloors;
  const towerHeightM = project.typeFloors?.heightM ?? project.floorHeight;
  const towerH = Math.max(0, towerCount) * Math.max(0, towerHeightM);

  const totalH = groundH + podiumH + towerH;

  const { sceneVolumes, volumeLabels } = useMemo(() => {
    const out: Volume[] = [];
    const labels: string[] = [];
    if (basementH > 0 && plotPoly.length >= 3) {
      out.push({ polygon: plotPoly, fromY: -basementH, toY: 0, kind: "basement" });
      labels.push(basementCount > 1 ? `Basement · ${basementCount}F` : "Basement");
    }
    let y = 0;
    if (groundH > 0 && groundPoly.length >= 3) {
      out.push({ polygon: groundPoly, fromY: y, toY: y + groundH, kind: "ground" });
      labels.push(groundCount > 1 ? `Ground · ${groundCount}F` : "Ground");
      y += groundH;
    }
    if (podiumH > 0 && podiumPoly.length >= 3) {
      out.push({ polygon: podiumPoly, fromY: y, toY: y + podiumH, kind: "podium" });
      labels.push(podiumCount > 1 ? `Podium · ${podiumCount}F` : "Podium");
      y += podiumH;
    }
    if (towerH > 0 && towerPoly.length >= 3) {
      out.push({ polygon: towerPoly, fromY: y, toY: y + towerH, kind: "tower" });
      labels.push(`Tower · ${towerCount}F`);
    }
    return { sceneVolumes: out, volumeLabels: labels };
  }, [plotPoly, groundPoly, podiumPoly, towerPoly, basementH, groundH, podiumH, towerH, basementCount, groundCount, podiumCount, towerCount]);

  const totalVolumeGFA = groundArea * groundCount + podiumArea * podiumCount + towerArea * towerCount;
  const computedFar = plotPolyArea > 0 ? totalVolumeGFA / plotPolyArea : 0;

  const [viewMode, setViewMode] = useState<"studio" | "context">("studio");
  const [viewPreset, setViewPreset] = useState<{ kind: "iso" | "front" | "top"; nonce: number } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const captureRef = useRef<(() => string) | null>(null);

  function requestPreset(kind: "iso" | "front" | "top") {
    setAutoRotate(false);
    setViewPreset((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  function downloadSnapshot() {
    const data = captureRef.current?.();
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase() || "project"}-massing.png`;
    a.click();
  }
  const hasGeoCoords =
    typeof project.latitude === "number" && typeof project.longitude === "number"
      && project.latitude !== 0 && project.longitude !== 0;
  const canShowContext = hasGeoCoords;

  // ---- plot editor handlers ----
  function setPlotMode(next: "rectangular" | "polygon") {
    if (next === "polygon" && (!project.plotPolygon || project.plotPolygon.length < 3)) {
      patch({ plotMode: "polygon", plotPolygon: rectanglePlotPolygon(frontage, depth) });
    } else {
      patch({ plotMode: next });
    }
  }

  function updateVertex(i: number, p: Partial<Point>) {
    if (!project.plotPolygon) return;
    const next = project.plotPolygon.map((v, idx) => (idx === i ? { ...v, ...p } : v));
    patch({ plotPolygon: next });
  }

  function addVertexAfter(i: number) {
    if (!project.plotPolygon) return;
    const a = project.plotPolygon[i];
    const b = project.plotPolygon[(i + 1) % project.plotPolygon.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const next = [...project.plotPolygon.slice(0, i + 1), mid, ...project.plotPolygon.slice(i + 1)];
    patch({ plotPolygon: next });
  }

  function deleteVertex(i: number) {
    if (!project.plotPolygon) return;
    if (project.plotPolygon.length <= 3) {
      alert("A polygon needs at least 3 vertices.");
      return;
    }
    const next = project.plotPolygon.filter((_, idx) => idx !== i);
    patch({ plotPolygon: next });
  }

  function recentrePolygon() {
    if (!project.plotPolygon) return;
    const c = polygonCentroid(project.plotPolygon);
    const next = project.plotPolygon.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    patch({ plotPolygon: next });
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Massing study · 3D</h2>
            <p className="section-sub">
              Estratificación simple: el <strong>basement</strong> ocupa la línea de fachada
              completa; <strong>ground</strong>, <strong>podium</strong> y <strong>torre</strong>{" "}
              se construyen sobre la huella del solar con su propio setback uniforme. Las alturas
              de cada tramo vienen del breakdown de Setup.
            </p>
          </div>
          <div className="inline-flex border border-ink-200 bg-bone-50">
            <button
              onClick={() => setPlotMode("rectangular")}
              className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "rectangular" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >Rectangular</button>
            <button
              onClick={() => setPlotMode("polygon")}
              className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "polygon" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >Polygon (irregular)</button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <div className="grid gap-4 content-start">
            <div className="relative aspect-[4/3] lg:aspect-auto lg:h-[calc(100vh-260px)] lg:min-h-[380px] lg:max-h-[640px] border border-ink-200 bg-bone-100 overflow-hidden">
              {viewMode === "context" && canShowContext ? (
                <MassingContextScene
                  plot={plotPoly}
                  buildable={towerPoly}
                  volumes={sceneVolumes}
                  primaryFootprint={towerPoly}
                  floorHeight={towerHeightM > 0 ? towerHeightM : project.floorHeight}
                  edgeColors={edgeColors}
                  building={{
                    basementCount,
                    basementHeightM,
                    groundCount,
                    groundHeightM,
                    podiumCount,
                    podiumHeightM,
                    towerCount,
                    towerHeightM,
                    totalHeightAboveGroundM: totalH,
                    towerFootprintM2: towerArea,
                  }}
                  latitude={project.latitude!}
                  longitude={project.longitude!}
                  northHeadingDeg={project.northHeadingDeg ?? 0}
                  buildingYOffsetM={project.groundElevationM ?? 0}
                  buildingXOffsetM={project.contextOffsetXM ?? 0}
                  buildingZOffsetM={project.contextOffsetZM ?? 0}
                  mapStyle={
                    // Older saves may carry the removed "photoreal" style — fall back to topo.
                    project.contextMapStyle === "topo" || project.contextMapStyle === "satellite" || project.contextMapStyle === "schematic"
                      ? project.contextMapStyle
                      : "topo"
                  }
                  nearbyHeightOverrides={project.nearbyHeightOverrides}
                  nearbyHidden={project.nearbyHidden}
                  customNeighbors={project.customNeighbors}
                  onSetHeight={(id, h) => {
                    const next = { ...(project.nearbyHeightOverrides ?? {}) };
                    next[id] = h;
                    patch({ nearbyHeightOverrides: next });
                  }}
                  onToggleHide={(id, hide) => {
                    const cur = new Set(project.nearbyHidden ?? []);
                    if (hide) cur.add(id);
                    else cur.delete(id);
                    patch({ nearbyHidden: Array.from(cur) });
                  }}
                  onSetMapStyle={(s) => patch({ contextMapStyle: s })}
                  onSetBuildingOffset={(x, z) => patch({ contextOffsetXM: x, contextOffsetZM: z })}
                  onAddCustomNeighbor={(centerX, centerZ) => {
                    const id = `cn-${Date.now()}`;
                    const next = [...(project.customNeighbors ?? []), {
                      id,
                      centerX: Number(centerX.toFixed(2)),
                      centerZ: Number(centerZ.toFixed(2)),
                      rotationDeg: 0,
                      widthM: 30,
                      depthM: 30,
                      heightM: 18,
                    }];
                    patch({ customNeighbors: next });
                    return id;
                  }}
                  onUpdateCustomNeighbor={(id, partial) => {
                    const next = (project.customNeighbors ?? []).map((n) =>
                      n.id === id ? { ...n, ...partial } : n,
                    );
                    patch({ customNeighbors: next });
                  }}
                  onDeleteCustomNeighbor={(id) => {
                    const next = (project.customNeighbors ?? []).filter((n) => n.id !== id);
                    patch({ customNeighbors: next });
                  }}
                  onDuplicateCustomNeighbor={(id) => {
                    const src = (project.customNeighbors ?? []).find((n) => n.id === id);
                    if (!src) return id;
                    const newId = `cn-${Date.now()}`;
                    const offset = Math.max(8, src.widthM * 0.6);
                    const copy = {
                      ...src,
                      id: newId,
                      centerX: Number((src.centerX + offset).toFixed(2)),
                      centerZ: src.centerZ,
                      name: src.name ? `${src.name} copy` : undefined,
                      tower: src.tower ? { ...src.tower } : undefined,
                    };
                    patch({ customNeighbors: [...(project.customNeighbors ?? []), copy] });
                    return newId;
                  }}
                  onShuffleTowers={(minH, maxH) => {
                    const next = (project.customNeighbors ?? []).map((n) => {
                      if (!n.tower) return n;
                      const newH = Math.round((minH + Math.random() * (maxH - minH)) * 10) / 10;
                      const maxOffsetX = Math.max(0, (n.widthM - n.tower.widthM) / 2);
                      const maxOffsetZ = Math.max(0, (n.depthM - n.tower.depthM) / 2);
                      return {
                        ...n,
                        tower: {
                          ...n.tower,
                          heightM: newH,
                          offsetXM: Number(((Math.random() * 2 - 1) * maxOffsetX).toFixed(2)),
                          offsetZM: Number(((Math.random() * 2 - 1) * maxOffsetZ).toFixed(2)),
                        },
                      };
                    });
                    patch({ customNeighbors: next });
                  }}
                />
              ) : (
                <MassingScene
                  plot={plotPoly}
                  buildable={towerPoly}
                  volumes={sceneVolumes}
                  primaryFootprint={towerPoly}
                  floorHeight={towerHeightM > 0 ? towerHeightM : project.floorHeight}
                  showFrontMarker={mode === "rectangular"}
                  edgeColors={edgeColors}
                  volumeLabels={volumeLabels}
                  showAnnotations={showAnnotations}
                  viewPreset={viewPreset}
                  autoRotate={autoRotate}
                  captureRef={captureRef}
                />
              )}
              <div className="absolute top-2 right-2 inline-flex border border-ink-200 bg-white/90 backdrop-blur-sm shadow-sm">
                <button
                  onClick={() => setViewMode("studio")}
                  className={`px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] transition-colors ${
                    viewMode === "studio" ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-50"
                  }`}
                >Studio</button>
                <button
                  onClick={() => canShowContext && setViewMode("context")}
                  disabled={!canShowContext}
                  title={!canShowContext ? "Set latitude / longitude in Setup" : ""}
                  className={`px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] transition-colors ${
                    viewMode === "context" ? "bg-ink-900 text-bone-100" : canShowContext ? "text-ink-700 hover:bg-bone-50" : "text-ink-300 cursor-not-allowed"
                  }`}
                >In context</button>
              </div>
              {!canShowContext && (
                <div className="absolute top-12 right-2 max-w-[260px] bg-amber-50/95 border border-amber-200 px-3 py-2 text-[10.5px] text-amber-900 leading-snug shadow-sm">
                  Set latitude / longitude in <strong>Setup</strong> to enable the in-context view.
                </div>
              )}
              {viewMode === "studio" && (
                <div className="absolute bottom-2 left-2 flex items-stretch gap-1.5 flex-wrap">
                  <div className="inline-flex border border-ink-200 bg-white/90 backdrop-blur-sm shadow-sm">
                    {([["iso", "Iso"], ["front", "Front"], ["top", "Top"]] as const).map(([kind, label]) => (
                      <button
                        key={kind}
                        onClick={() => requestPreset(kind)}
                        className="px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] text-ink-700 hover:bg-bone-50 transition-colors"
                        title={`${label} view`}
                      >{label}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => setAutoRotate((v) => !v)}
                    className={`px-3 py-1.5 border border-ink-200 text-[10.5px] font-medium uppercase tracking-[0.10em] shadow-sm transition-colors ${
                      autoRotate ? "bg-ink-900 text-bone-100" : "bg-white/90 backdrop-blur-sm text-ink-700 hover:bg-bone-50"
                    }`}
                    title="Slow turntable rotation"
                  >⟳ Orbit</button>
                  <button
                    onClick={() => setShowAnnotations((v) => !v)}
                    className={`px-3 py-1.5 border border-ink-200 text-[10.5px] font-medium uppercase tracking-[0.10em] shadow-sm transition-colors ${
                      showAnnotations ? "bg-ink-900 text-bone-100" : "bg-white/90 backdrop-blur-sm text-ink-700 hover:bg-bone-50"
                    }`}
                    title="Toggle height dimension and tier labels"
                  >Dims</button>
                  <button
                    onClick={downloadSnapshot}
                    className="px-3 py-1.5 border border-ink-200 bg-white/90 backdrop-blur-sm text-[10.5px] font-medium uppercase tracking-[0.10em] text-ink-700 hover:bg-bone-50 shadow-sm transition-colors"
                    title="Download the current view as a PNG image"
                  >↓ PNG</button>
                </div>
              )}
            </div>

            {project.parcel && (
              <div className="border border-ink-200 bg-bone-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-ink-200 bg-white flex items-center justify-between gap-3 flex-wrap">
                  <span className="eyebrow text-ink-500">Reference plan</span>
                  {project.parcel.calibration && (
                    <span className="tag-ok">Calibrated · {project.parcel.calibration.metres.toFixed(2)} m ref</span>
                  )}
                </div>
                <PlanTrace
                  parcel={project.parcel}
                  mode="idle"
                  tracePolygonPx={project.parcel.tracePolygonPx}
                  calibration={project.parcel.calibration}
                  edgeColors={
                    mode === "polygon" && project.parcel.tracePolygonPx
                      ? project.parcel.tracePolygonPx.map((_, i) => edgeColor(i))
                      : undefined
                  }
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 content-start">
            <TierSummary
              groundCount={groundCount}
              groundHeightM={groundHeightM}
              podiumCount={podiumCount}
              podiumHeightM={podiumHeightM}
              towerCount={towerCount}
              towerHeightM={towerHeightM}
              basementCount={basementCount}
              basementHeightM={basementHeightM}
              groundArea={groundArea}
              podiumArea={podiumArea}
              towerArea={towerArea}
              plotArea={plotPolyArea}
            />

            <SetbacksTable
              plotPoly={plotPoly}
              groundEdges={groundEdges}
              podiumEdges={podiumEdges}
              towerEdges={towerEdges}
              groundUni={groundUni}
              podiumUni={podiumUni}
              towerUni={towerUni}
              onPatch={patch}
            />

            <TowerOffset
              dx={towerDx}
              dy={towerDy}
              onPatch={patch}
            />

            <div className="border border-ink-200">
              <div className="grid grid-cols-2 divide-x divide-ink-200 border-b border-ink-200">
                <HeroStat label="Height above ground" value={fmt2(totalH)} unit="m" />
                <HeroStat label="FAR (volume)" value={computedFar.toFixed(2)} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm p-3 bg-bone-50/40">
                <Stat label="Plot area" value={`${fmt2(plotPolyArea)} m²`} />
                <Stat label="Tower footprint" value={`${fmt2(towerArea)} m²`} />
                <Stat label="Basement depth" value={`${fmt2(basementH)} m`} />
                <Stat label="Σ Volume GFA" value={`${fmt2(totalVolumeGFA)} m²`} />
              </div>
            </div>

            <Collapsible
              title={mode === "polygon" ? "Plot geometry · vertices" : "Plot dimensions"}
              defaultOpen={mode === "polygon" ? (project.plotPolygon?.length ?? 0) === 0 : false}
            >
              {mode === "rectangular" ? (
                <RectangularInputs project={project} patch={patch} placeholder={sqRoot.toFixed(1)} />
              ) : (
                <PolygonInputs
                  vertices={project.plotPolygon ?? []}
                  onUpdate={updateVertex}
                  onAddAfter={addVertexAfter}
                  onDelete={deleteVertex}
                  onRecentre={recentrePolygon}
                />
              )}
            </Collapsible>

            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-ink-500 flex-wrap">
              <span className="inline-block w-3 h-3 bg-[#ede9df] border border-[#3f5135]" />
              Plot
              <span className="inline-block w-3 h-3 bg-[#647d57] ml-3" />
              Tower
              {groundH > 0 && (
                <>
                  <span className="inline-block w-3 h-3 bg-[#8a9a76] ml-3" />
                  Ground
                </>
              )}
              {podiumH > 0 && (
                <>
                  <span className="inline-block w-3 h-3 bg-[#a3b08a] ml-3" />
                  Podium
                </>
              )}
              {basementH > 0 && (
                <>
                  <span className="inline-block w-3 h-3 bg-[#bdb9ad] ml-3" />
                  Basement
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Tier setbacks                                 */
/* -------------------------------------------------------------------------- */

function TierSummary({
  groundCount, groundHeightM,
  podiumCount, podiumHeightM,
  towerCount, towerHeightM,
  basementCount, basementHeightM,
  groundArea, podiumArea, towerArea, plotArea,
}: {
  groundCount: number; groundHeightM: number;
  podiumCount: number; podiumHeightM: number;
  towerCount: number; towerHeightM: number;
  basementCount: number; basementHeightM: number;
  groundArea: number; podiumArea: number; towerArea: number; plotArea: number;
}) {
  const rows: Array<{ label: string; floors: number; heightM: number; footprint: number; kind: "basement" | "ground" | "podium" | "tower" }> = [
    { label: "Basement", floors: basementCount, heightM: basementHeightM, footprint: plotArea, kind: "basement" },
    { label: "Ground", floors: groundCount, heightM: groundHeightM, footprint: groundArea, kind: "ground" },
    { label: "Podium", floors: podiumCount, heightM: podiumHeightM, footprint: podiumArea, kind: "podium" },
    { label: "Tower (type floors)", floors: towerCount, heightM: towerHeightM, footprint: towerArea, kind: "tower" },
  ];
  const swatch: Record<typeof rows[number]["kind"], string> = {
    basement: "#bdb9ad",
    ground: "#8a9a76",
    podium: "#a3b08a",
    tower: "#647d57",
  };
  return (
    <div className="border border-ink-200">
      <div className="grid grid-cols-[1fr_70px_70px_90px] gap-1 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
        <div>Tier</div>
        <div className="text-right">Floors</div>
        <div className="text-right">Floor h m</div>
        <div className="text-right">Footprint m²</div>
      </div>
      {rows.map((r) => (
        <div key={r.kind} className="grid grid-cols-[1fr_70px_70px_90px] gap-1 px-3 py-2 items-center text-[12px] tabular-nums border-b border-ink-100 last:border-b-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-3 h-3 shrink-0" style={{ backgroundColor: swatch[r.kind] }} />
            <span className="text-ink-900 truncate">{r.label}</span>
          </div>
          <div className="text-right text-ink-700">{r.floors > 0 ? r.floors : "—"}</div>
          <div className="text-right text-ink-700">{r.heightM > 0 ? r.heightM.toFixed(2) : "—"}</div>
          <div className="text-right text-ink-900">{r.footprint > 0 ? Math.round(r.footprint).toLocaleString("en-US") : "—"}</div>
        </div>
      ))}
      <div className="px-3 py-2 text-[10.5px] text-ink-500 leading-snug border-t border-ink-100">
        Floor counts and heights come from <strong>Setup → Floor breakdown</strong>. Edit there to change them.
      </div>
    </div>
  );
}

function SetbacksTable({
  plotPoly, groundEdges, podiumEdges, towerEdges,
  groundUni, podiumUni, towerUni,
  onPatch,
}: {
  plotPoly: Point[];
  groundEdges: number[];
  podiumEdges: number[];
  towerEdges: number[];
  groundUni: number;
  podiumUni: number;
  towerUni: number;
  onPatch: (p: Partial<ReturnType<typeof useProject>>) => void;
}) {
  const lengths = edgeLengths(plotPoly);

  function updateEdge(tier: "ground" | "podium" | "tower", i: number, v: number) {
    const safe = Math.max(0, v);
    const baseUniform = tier === "ground" ? groundUni : tier === "podium" ? podiumUni : towerUni;
    const baseArray = tier === "ground" ? groundEdges : tier === "podium" ? podiumEdges : towerEdges;
    const next = baseArray.length === plotPoly.length ? [...baseArray] : plotPoly.map(() => baseUniform);
    next[i] = safe;
    const field = tier === "ground" ? "groundSetbackPerEdge" : tier === "podium" ? "podiumSetbackPerEdge" : "towerSetbackPerEdge";
    onPatch({ [field]: next } as Partial<ReturnType<typeof useProject>>);
  }

  function applyUniform(tier: "ground" | "podium" | "tower", v: number) {
    const safe = Math.max(0, v);
    const next = plotPoly.map(() => safe);
    if (tier === "ground") onPatch({ groundSetbackM: safe, groundSetbackPerEdge: next });
    else if (tier === "podium") onPatch({ podiumSetbackM: safe, podiumSetbackPerEdge: next });
    else onPatch({ towerSetbackM: safe, towerSetbackPerEdge: next });
  }

  return (
    <div className="border border-ink-200">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200">
        <div className="eyebrow text-ink-500 text-[10px] mb-1.5">Setbacks per edge (m)</div>
        <div className="grid grid-cols-[24px_28px_1fr_60px_60px_60px] gap-1 text-[10px] uppercase tracking-[0.08em] text-ink-500">
          <span></span>
          <span>#</span>
          <span>Length</span>
          <span className="text-right text-[#8a9a76]">Ground</span>
          <span className="text-right text-[#a3b08a]">Podium</span>
          <span className="text-right text-[#647d57]">Tower</span>
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {plotPoly.map((_, i) => {
          const color = edgeColor(i);
          return (
            <div key={i} className="grid grid-cols-[24px_28px_1fr_60px_60px_60px] gap-1 px-3 py-1 items-center text-[11.5px] tabular-nums border-b border-ink-100 last:border-b-0">
              <span className="block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-[11px] text-ink-500">{i + 1}</span>
              <span className="text-ink-700">{fmt2(lengths[i] ?? 0)} m</span>
              <input
                type="number"
                step={0.5}
                min={0}
                className="cell-input text-right !py-0.5 !px-1.5"
                value={Number((groundEdges[i] ?? groundUni).toFixed(1))}
                onChange={(e) => updateEdge("ground", i, parseFloat(e.target.value) || 0)}
              />
              <input
                type="number"
                step={0.5}
                min={0}
                className="cell-input text-right !py-0.5 !px-1.5"
                value={Number((podiumEdges[i] ?? podiumUni).toFixed(1))}
                onChange={(e) => updateEdge("podium", i, parseFloat(e.target.value) || 0)}
              />
              <input
                type="number"
                step={0.5}
                min={0}
                className="cell-input text-right !py-0.5 !px-1.5"
                value={Number((towerEdges[i] ?? towerUni).toFixed(1))}
                onChange={(e) => updateEdge("tower", i, parseFloat(e.target.value) || 0)}
              />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[24px_28px_1fr_60px_60px_60px] gap-1 px-3 py-2 items-center text-[10.5px] uppercase tracking-[0.10em] text-ink-500 bg-bone-50/40 border-t border-ink-200">
        <span></span>
        <span></span>
        <span>Apply uniform →</span>
        <input
          type="number"
          step={0.5}
          min={0}
          className="cell-input text-right !py-0.5 !px-1.5"
          value={Number(groundUni.toFixed(1))}
          onChange={(e) => applyUniform("ground", parseFloat(e.target.value) || 0)}
          title="Set every edge to this value for Ground"
        />
        <input
          type="number"
          step={0.5}
          min={0}
          className="cell-input text-right !py-0.5 !px-1.5"
          value={Number(podiumUni.toFixed(1))}
          onChange={(e) => applyUniform("podium", parseFloat(e.target.value) || 0)}
          title="Set every edge to this value for Podium"
        />
        <input
          type="number"
          step={0.5}
          min={0}
          className="cell-input text-right !py-0.5 !px-1.5"
          value={Number(towerUni.toFixed(1))}
          onChange={(e) => applyUniform("tower", parseFloat(e.target.value) || 0)}
          title="Set every edge to this value for Tower"
        />
      </div>
      <p className="px-3 py-2 text-[10.5px] text-ink-500 leading-snug border-t border-ink-100">
        Basement always follows the plot line (no setback). The colour swatch matches the edge in the
        3D viewer and on the reference plan.
      </p>
    </div>
  );
}

function TowerOffset({
  dx, dy, onPatch,
}: {
  dx: number;
  dy: number;
  onPatch: (p: Partial<ReturnType<typeof useProject>>) => void;
}) {
  return (
    <div className="border border-ink-200">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200">
        <div className="eyebrow text-ink-500 text-[10px]">Tower position offset (m)</div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3">
        <Field label="X (right +)">
          <input
            type="number"
            step={0.5}
            className="cell-input text-right"
            value={Number(dx.toFixed(2))}
            onChange={(e) => onPatch({ towerOffsetXM: parseFloat(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Y (up +)">
          <input
            type="number"
            step={0.5}
            className="cell-input text-right"
            value={Number(dy.toFixed(2))}
            onChange={(e) => onPatch({ towerOffsetYM: parseFloat(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <p className="px-3 pb-3 text-[10.5px] text-ink-500 leading-snug">
        Shift the tower footprint after the setback offset. Leave at 0 for a centred tower.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Plot geometry                                 */
/* -------------------------------------------------------------------------- */

function RectangularInputs({
  project, patch, placeholder,
}: {
  project: ReturnType<typeof useProject>;
  patch: (p: Partial<ReturnType<typeof useProject>>) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="eyebrow text-ink-500 mb-2">Plot dimensions (m)</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frontage">
          <NumInput value={project.plotFrontage} onChange={(v) => patch({ plotFrontage: v })} placeholder={placeholder} />
        </Field>
        <Field label="Depth">
          <NumInput value={project.plotDepth} onChange={(v) => patch({ plotDepth: v })} placeholder={placeholder} />
        </Field>
      </div>
      <p className="text-[11px] text-ink-500 mt-2">
        Empty fields fall back to a square derived from plot area.
      </p>
    </div>
  );
}

function PolygonInputs({
  vertices, onUpdate, onAddAfter, onDelete, onRecentre,
}: {
  vertices: Point[];
  onUpdate: (i: number, p: Partial<Point>) => void;
  onAddAfter: (i: number) => void;
  onDelete: (i: number) => void;
  onRecentre: () => void;
}) {
  const lengths = edgeLengths(vertices);
  const perimeter = polygonPerimeter(vertices);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="eyebrow text-ink-500">Vertices (m)</div>
        <button
          onClick={onRecentre}
          className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900"
          title="Re-centre the polygon at the origin"
        >Centre</button>
      </div>
      <div className="border border-ink-200">
        <div className="grid grid-cols-[28px_1fr_1fr_92px_28px] gap-1 px-2 py-1.5 text-[10.5px] uppercase tracking-[0.10em] text-ink-500 bg-bone-50 border-b border-ink-200">
          <span>#</span><span>X</span><span>Y</span><span className="text-right">Edge →</span><span></span>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {vertices.map((v, i) => (
            <div key={i} className="grid grid-cols-[28px_1fr_1fr_92px_28px] gap-1 px-2 py-1 items-center border-b border-ink-100 last:border-b-0">
              <span className="text-[11px] text-ink-500 tabular-nums">{i + 1}</span>
              <input
                type="number"
                step={0.01}
                className="cell-input text-right"
                value={v.x}
                onChange={(e) => onUpdate(i, { x: parseFloat(e.target.value) || 0 })}
              />
              <input
                type="number"
                step={0.01}
                className="cell-input text-right"
                value={v.y}
                onChange={(e) => onUpdate(i, { y: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-right text-[11px] text-ink-700 tabular-nums" title={`Length to vertex ${((i + 1) % vertices.length) + 1}`}>
                {fmt2(lengths[i] ?? 0)} m
              </span>
              <button
                onClick={() => onDelete(i)}
                className="text-ink-400 hover:text-red-700 text-base leading-none"
                title="Delete vertex"
                aria-label="Delete vertex"
              >×</button>
              <span></span>
              <span className="col-span-3 -mt-0.5 -mb-0.5">
                <button
                  onClick={() => onAddAfter(i)}
                  className="block w-full text-[10px] text-ink-400 hover:text-qube-700 hover:bg-qube-50 py-0.5"
                  title="Insert vertex after this one"
                >+ insert vertex here</button>
              </span>
              <span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 text-[11px] text-ink-500 flex justify-between">
        <span>{vertices.length} vertices</span>
        <span className="tabular-nums">Perimeter: {fmt2(perimeter)} m</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Small helpers                                 */
/* -------------------------------------------------------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value, onChange, step = 1, placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      min={0}
      className="cell-input text-right"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") onChange(undefined);
        else {
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) && n >= 0 ? n : undefined);
        }
      }}
    />
  );
}

function HeroStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="eyebrow text-ink-500 text-[9.5px] mb-0.5">{label}</div>
      <div className="text-ink-900 tabular-nums text-xl font-semibold leading-none">
        {value}
        {unit && <span className="text-[12px] font-normal text-ink-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className="text-ink-900 tabular-nums">{value}</div>
    </div>
  );
}

function Collapsible({
  title, defaultOpen, children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="border border-ink-200" open={defaultOpen}>
      <summary className="cursor-pointer list-none px-3 py-2 bg-bone-50 border-b border-ink-200 text-[11px] uppercase tracking-[0.10em] text-ink-700 hover:bg-bone-100 flex items-center justify-between">
        <span>{title}</span>
        <span className="text-ink-400 text-[14px] leading-none">▾</span>
      </summary>
      <div className="grid gap-4 p-3">{children}</div>
    </details>
  );
}
