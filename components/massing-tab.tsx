"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt2, fmtPct } from "@/lib/format";
import PlanTrace from "./plan-trace";
import VariantCard from "./variant-card";
import {
  type Point,
  edgeLengths,
  offsetPolygon,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  rectanglePlotPolygon,
  rectangleToPolygon,
} from "@/lib/geom";
import { edgeColor } from "@/lib/edge-colors";
import { buildMassing, type CornerPosition, type MassingShape, type SidePosition, type TowerPosition } from "@/lib/massing";
import { generateVariants, type Variant, type VariantParams } from "@/lib/variants";

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

export default function MassingTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const program = computeProgram(project);

  const mode = project.plotMode === "polygon" ? "polygon" : "rectangular";

  // ---- derive plot polygon ----
  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;

  const sFront = project.setbackFront ?? 0;
  const sRear = project.setbackRear ?? 0;
  const sSide = project.setbackSide ?? 0;
  const sUniform = project.setbackUniform ?? Math.max(sFront, sRear, sSide, 3);

  const plotPoly: Point[] = useMemo(() => {
    if (mode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
      return project.plotPolygon;
    }
    return rectanglePlotPolygon(frontage, depth);
  }, [mode, project.plotPolygon, frontage, depth]);

  // Per-edge setbacks. If user has set them and length matches, use them; otherwise fall back to uniform.
  const setbackPerEdge: number[] = useMemo(() => {
    if (mode !== "polygon") return [];
    const n = plotPoly.length;
    if (project.setbackPerEdge && project.setbackPerEdge.length === n) return project.setbackPerEdge;
    return new Array(n).fill(sUniform);
  }, [mode, plotPoly.length, project.setbackPerEdge, sUniform]);

  const buildablePoly: Point[] = useMemo(() => {
    if (mode === "polygon") return offsetPolygon(plotPoly, setbackPerEdge);
    return rectangleToPolygon(frontage, depth, sFront, sRear, sSide);
  }, [mode, plotPoly, setbackPerEdge, frontage, depth, sFront, sRear, sSide]);

  const edgeColors = useMemo(
    () => (mode === "polygon" ? plotPoly.map((_, i) => edgeColor(i)) : undefined),
    [mode, plotPoly]
  );

  const plotPolyArea = polygonArea(plotPoly);
  const buildableArea = polygonArea(buildablePoly);

  // Effective volume controls — overrides on top of program-derived values.
  const programFloorArea = project.numFloors > 0 ? program.totalGFABuilding / project.numFloors : 0;
  const effFloors = project.massingFloors ?? project.numFloors;
  const effFloorArea = project.massingFloorArea ?? programFloorArea;
  const buildingHeight = effFloors * project.floorHeight;

  // Shape preset + parameters with sensible defaults
  const shape: MassingShape = project.massingShape ?? "block";
  const podiumFloors = project.podiumFloors ?? Math.min(2, effFloors);
  const podiumCoverage = project.podiumCoverage ?? 0.95;
  const towerCoverage = project.towerCoverage ?? 0.45;
  const towerPosition: TowerPosition = project.towerPosition ?? "C";
  const courtyardRatio = project.courtyardRatio ?? 0.18;
  const twinSeparation = project.twinSeparation ?? Math.max(8, Math.sqrt(buildableArea) * 0.25);
  const twinCoverage = project.twinCoverage ?? 0.28;
  const steppedSteps = project.steppedSteps ?? 4;
  const steppedShrink = project.steppedShrink ?? 0.15;
  const lNotchPosition: CornerPosition = project.lNotchPosition ?? "NE";
  const lNotchRatio = project.lNotchRatio ?? 0.32;
  const uOpening: SidePosition = project.uOpening ?? "N";
  const uArmRatio = project.uArmRatio ?? 0.28;
  const uNotchDepth = project.uNotchDepth ?? 0.55;

  const massing = useMemo(
    () =>
      buildMassing({
        buildable: buildablePoly,
        effFloors,
        effFloorArea,
        floorHeight: project.floorHeight,
        shape,
        podiumFloors,
        podiumCoverage,
        towerCoverage,
        towerPosition,
        courtyardRatio,
        twinSeparation,
        twinCoverage,
        steppedSteps,
        steppedShrink,
        lNotchPosition,
        lNotchRatio,
        uOpening,
        uArmRatio,
        uNotchDepth,
      }),
    [
      buildablePoly,
      effFloors,
      effFloorArea,
      project.floorHeight,
      shape,
      podiumFloors,
      podiumCoverage,
      towerCoverage,
      towerPosition,
      courtyardRatio,
      twinSeparation,
      twinCoverage,
      steppedSteps,
      steppedShrink,
      lNotchPosition,
      lNotchRatio,
      uOpening,
      uArmRatio,
      uNotchDepth,
    ]
  );

  const totalVolumeGFA = massing.totalGFA;

  // Variants
  const [variants, setVariants] = useState<Variant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  // 3D viewer mode: studio (existing) vs in-context (Google Photorealistic 3D Tiles)
  const [viewMode, setViewMode] = useState<"studio" | "context">("studio");
  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const hasGeoCoords =
    typeof project.latitude === "number" && typeof project.longitude === "number"
      && project.latitude !== 0 && project.longitude !== 0;
  const canShowContext = hasGeoCoords && googleApiKey.length > 0;

  function exploreVariants() {
    const list = generateVariants({
      buildable: buildablePoly,
      effFloors,
      effFloorArea,
      floorHeight: project.floorHeight,
      programGFA: program.totalGFABuilding,
      plotArea: plotPolyArea,
      maxFAR: project.maxFAR,
      maxHeightM: project.maxHeightM,
    });
    setVariants(list);
  }

  function applyVariant(v: Variant) {
    const p: Partial<typeof project> = { massingShape: v.params.shape };
    const params = v.params;
    if (params.shape === "block") {
      if (params.floorArea !== undefined) p.massingFloorArea = params.floorArea;
    } else if (params.shape === "podiumTower") {
      if (params.podiumFloors !== undefined) p.podiumFloors = params.podiumFloors;
      if (params.podiumCoverage !== undefined) p.podiumCoverage = params.podiumCoverage;
      if (params.towerCoverage !== undefined) p.towerCoverage = params.towerCoverage;
      if (params.towerPosition !== undefined) p.towerPosition = params.towerPosition;
    } else if (params.shape === "courtyard") {
      if (params.courtyardRatio !== undefined) p.courtyardRatio = params.courtyardRatio;
      if (params.floorArea !== undefined) p.massingFloorArea = params.floorArea;
    } else if (params.shape === "twinTowers") {
      if (params.twinSeparation !== undefined) p.twinSeparation = params.twinSeparation;
      if (params.twinCoverage !== undefined) p.twinCoverage = params.twinCoverage;
    } else if (params.shape === "stepped") {
      if (params.steppedSteps !== undefined) p.steppedSteps = params.steppedSteps;
      if (params.steppedShrink !== undefined) p.steppedShrink = params.steppedShrink;
      if (params.floorArea !== undefined) p.massingFloorArea = params.floorArea;
    } else if (params.shape === "lShape") {
      if (params.lNotchPosition !== undefined) p.lNotchPosition = params.lNotchPosition;
      if (params.lNotchRatio !== undefined) p.lNotchRatio = params.lNotchRatio;
      if (params.floorArea !== undefined) p.massingFloorArea = params.floorArea;
    } else if (params.shape === "uShape") {
      if (params.uOpening !== undefined) p.uOpening = params.uOpening;
      if (params.uArmRatio !== undefined) p.uArmRatio = params.uArmRatio;
      if (params.uNotchDepth !== undefined) p.uNotchDepth = params.uNotchDepth;
      if (params.floorArea !== undefined) p.massingFloorArea = params.floorArea;
    }
    patch(p);
    setActiveVariantId(v.id);
  }
  const exceedsBuildable = effFloorArea > buildableArea + 0.01 && buildableArea > 0 && shape === "block";
  const coverageOfBuildable = buildableArea > 0 ? Math.min(1, (massing.volumes[0]?.polygon ? polygonArea(massing.volumes[0].polygon) : 0) / buildableArea) : 0;
  const plotCoverage = plotPolyArea > 0 && massing.volumes.length > 0 ? Math.min(1, polygonArea(massing.volumes[0].polygon) / plotPolyArea) : 0;
  const computedFar = plotPolyArea > 0 ? totalVolumeGFA / plotPolyArea : 0;
  const programVsVolumeDelta = totalVolumeGFA - program.totalGFABuilding;
  // ---- vertex editor handlers ----
  function setMode(next: "rectangular" | "polygon") {
    if (next === "polygon" && (!project.plotPolygon || project.plotPolygon.length < 3)) {
      // Seed polygon from current rectangular geometry
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
              Preliminary volumetric study. Building footprint = total GFA / number of floors, scaled to the buildable
              area shape. Drag to orbit, scroll to zoom.
            </p>
          </div>
          <div className="inline-flex border border-ink-200 bg-bone-50">
            <button
              onClick={() => setMode("rectangular")}
              className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "rectangular" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >Rectangular</button>
            <button
              onClick={() => setMode("polygon")}
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
                  buildable={buildablePoly}
                  volumes={massing.volumes}
                  primaryFootprint={massing.primaryFootprint}
                  floorHeight={project.floorHeight}
                  edgeColors={edgeColors}
                  latitude={project.latitude!}
                  longitude={project.longitude!}
                  northHeadingDeg={project.northHeadingDeg ?? 0}
                  apiKey={googleApiKey}
                />
              ) : (
                <MassingScene
                  plot={plotPoly}
                  buildable={buildablePoly}
                  volumes={massing.volumes}
                  primaryFootprint={massing.primaryFootprint}
                  floorHeight={project.floorHeight}
                  showFrontMarker={mode === "rectangular"}
                  edgeColors={edgeColors}
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
                  title={!canShowContext ? (hasGeoCoords ? "Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Netlify and redeploy" : "Set latitude / longitude in Setup") : ""}
                  className={`px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] transition-colors ${
                    viewMode === "context" ? "bg-ink-900 text-bone-100" : canShowContext ? "text-ink-700 hover:bg-bone-50" : "text-ink-300 cursor-not-allowed"
                  }`}
                >In context</button>
              </div>
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
            <ShapeSelector
              shape={shape}
              onShape={(s) => patch({ massingShape: s })}
            />

            <ShapeParams
              shape={shape}
              effFloors={effFloors}
              podiumFloors={podiumFloors}
              podiumCoverage={podiumCoverage}
              towerCoverage={towerCoverage}
              towerPosition={towerPosition}
              courtyardRatio={courtyardRatio}
              twinSeparation={twinSeparation}
              twinCoverage={twinCoverage}
              steppedSteps={steppedSteps}
              steppedShrink={steppedShrink}
              lNotchPosition={lNotchPosition}
              lNotchRatio={lNotchRatio}
              uOpening={uOpening}
              uArmRatio={uArmRatio}
              uNotchDepth={uNotchDepth}
              onPatch={(p) => patch(p)}
            />

            <VolumeInputs
              effFloors={effFloors}
              effFloorArea={effFloorArea}
              programFloorArea={programFloorArea}
              buildableArea={buildableArea}
              hasFloorsOverride={project.massingFloors !== undefined}
              hasFloorAreaOverride={project.massingFloorArea !== undefined}
              floorHeight={project.floorHeight}
              onFloors={(v) => patch({ massingFloors: v })}
              onFloorArea={(v) => patch({ massingFloorArea: v })}
              onMatchProgram={() => patch({ massingFloorArea: undefined, massingFloors: undefined })}
              onMatchBuildable={() => patch({ massingFloorArea: buildableArea })}
            />

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-ink-200 pt-3">
              <Stat label="Plot area" value={`${fmt2(plotPolyArea)} m²`} />
              <Stat label="Buildable" value={`${fmt2(buildableArea)} m²`} />
              <Stat label="Height" value={`${fmt2(buildingHeight)} m`} />
              <Stat label="Volume GFA" value={fmt2(totalVolumeGFA)} />
              <Stat
                label="vs program"
                value={`${programVsVolumeDelta >= 0 ? "+" : ""}${fmt2(programVsVolumeDelta)}`}
                good={Math.abs(programVsVolumeDelta) < 1}
                bad={programVsVolumeDelta < -1}
              />
              <Stat label="FAR" value={computedFar.toFixed(2)} />
              <Stat
                label="Cov / buildable"
                value={fmtPct(coverageOfBuildable)}
                good={!exceedsBuildable}
                bad={exceedsBuildable}
              />
              <Stat label="Cov / plot" value={fmtPct(plotCoverage)} />
            </div>

            {exceedsBuildable && (
              <div className="border border-amber-200 bg-amber-50 text-amber-900 p-2 text-[11px] leading-snug">
                Floor area exceeds buildable footprint — reduce area, add floors, or revise setbacks. The building is clamped.
              </div>
            )}

            <ConstraintsInputs
              maxFAR={project.maxFAR}
              maxHeightM={project.maxHeightM}
              currentFAR={computedFar}
              currentHeight={buildingHeight}
              onPatch={(p) => patch(p)}
            />

            <Collapsible
              title={mode === "polygon" ? "Plot geometry · vertices & setbacks" : "Plot dimensions & setbacks"}
              defaultOpen={mode === "polygon" ? (project.plotPolygon?.length ?? 0) === 0 : false}
            >
              {mode === "rectangular" ? (
                <RectangularInputs
                  project={project}
                  patch={patch}
                  placeholder={sqRoot.toFixed(1)}
                />
              ) : (
                <PolygonInputs
                  vertices={project.plotPolygon ?? []}
                  setbackUniform={sUniform}
                  setbackPerEdge={setbackPerEdge}
                  onSetback={(v) => patch({ setbackUniform: v })}
                  onSetbackPerEdge={(idx, v) => {
                    const next = [...setbackPerEdge];
                    next[idx] = v;
                    patch({ setbackPerEdge: next });
                  }}
                  onSetbackAll={(v) => {
                    const next = (project.plotPolygon ?? []).map(() => v);
                    patch({ setbackPerEdge: next, setbackUniform: v });
                  }}
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
              <span className="inline-block w-3 h-3 bg-[#bccab0] ml-3" />
              Buildable
              <span className="inline-block w-3 h-3 bg-[#647d57] ml-3" />
              Building
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="section-title">Variants</h2>
            <p className="section-sub">
              Generate and compare massing alternatives ranked by GFA fit, façade exposure and coverage efficiency.
              Click a thumbnail to apply its parameters to the 3D viewer above.
            </p>
          </div>
          <button
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
            onClick={exploreVariants}
            disabled={buildablePoly.length < 3}
          >
            {variants.length === 0 ? "Explore variants" : "Re-explore"}
          </button>
        </div>

        {variants.length === 0 ? (
          <div className="text-sm text-ink-500 italic py-8 text-center border border-dashed border-ink-200 bg-bone-50">
            No variants yet — click "Explore variants" to generate alternatives.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {variants.map((v) => (
              <VariantCard
                key={v.id}
                variant={v}
                plot={plotPoly}
                buildable={buildablePoly}
                programGFA={program.totalGFABuilding}
                active={v.id === activeVariantId}
                onApply={() => applyVariant(v)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

/* -------------------- subcomponents -------------------- */

const SHAPE_OPTIONS: { id: MassingShape; label: string; sub: string }[] = [
  { id: "block", label: "Single block", sub: "Uniform extrusion of the buildable area." },
  { id: "podiumTower", label: "Podium + tower", sub: "Wide podium at base, narrow tower above." },
  { id: "courtyard", label: "Courtyard", sub: "Perimeter ring with a central patio." },
  { id: "twinTowers", label: "Twin towers", sub: "Two parallel towers separated by a gap." },
  { id: "stepped", label: "Stepped / terraced", sub: "Footprint shrinks every few floors." },
  { id: "lShape", label: "L-shape", sub: "Notch removed from one corner." },
  { id: "uShape", label: "U-shape", sub: "Two arms wrapping a central courtyard." },
];

const CORNER_POSITIONS: CornerPosition[] = ["NW", "NE", "SW", "SE"];
const SIDE_POSITIONS: SidePosition[] = ["N", "E", "S", "W"];

function ShapeSelector({ shape, onShape }: { shape: MassingShape; onShape: (s: MassingShape) => void }) {
  return (
    <div>
      <div className="eyebrow text-ink-500 mb-2">Building shape</div>
      <div className="grid grid-cols-2 gap-2">
        {SHAPE_OPTIONS.map((o) => {
          const active = o.id === shape;
          return (
            <button
              key={o.id}
              onClick={() => onShape(o.id)}
              className={`text-left p-2.5 border transition-colors ${
                active
                  ? "border-qube-500 bg-qube-50"
                  : "border-ink-200 bg-white hover:border-qube-300 hover:bg-bone-50"
              }`}
            >
              <div className={`text-[12px] font-medium ${active ? "text-qube-800" : "text-ink-900"}`}>
                {o.label}
              </div>
              <div className="text-[10.5px] text-ink-500 mt-0.5 leading-snug">{o.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TOWER_POSITIONS: TowerPosition[] = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"];

function ShapeParams({
  shape,
  effFloors,
  podiumFloors,
  podiumCoverage,
  towerCoverage,
  towerPosition,
  courtyardRatio,
  twinSeparation,
  twinCoverage,
  steppedSteps,
  steppedShrink,
  lNotchPosition,
  lNotchRatio,
  uOpening,
  uArmRatio,
  uNotchDepth,
  onPatch,
}: {
  shape: MassingShape;
  effFloors: number;
  podiumFloors: number;
  podiumCoverage: number;
  towerCoverage: number;
  towerPosition: TowerPosition;
  courtyardRatio: number;
  twinSeparation: number;
  twinCoverage: number;
  steppedSteps: number;
  steppedShrink: number;
  lNotchPosition: CornerPosition;
  lNotchRatio: number;
  uOpening: SidePosition;
  uArmRatio: number;
  uNotchDepth: number;
  onPatch: (p: Record<string, unknown>) => void;
}) {
  if (shape === "block") return null;

  if (shape === "podiumTower") {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Podium floors (of ${effFloors})`}>
            <input
              type="number"
              step={1}
              min={0}
              max={effFloors}
              className="cell-input text-right"
              value={podiumFloors}
              onChange={(e) => onPatch({ podiumFloors: Math.max(0, Math.min(effFloors, Math.round(parseFloat(e.target.value) || 0))) })}
            />
          </Field>
          <Field label="Tower position">
            <select
              className="cell-input"
              value={towerPosition}
              onChange={(e) => onPatch({ towerPosition: e.target.value as TowerPosition })}
            >
              {TOWER_POSITIONS.map((p) => <option key={p} value={p}>{p === "C" ? "Centred" : p}</option>)}
            </select>
          </Field>
        </div>
        <PercentSlider
          label="Podium coverage of buildable"
          value={podiumCoverage}
          onChange={(v) => onPatch({ podiumCoverage: v })}
          min={0.4} max={1} step={0.01}
        />
        <PercentSlider
          label="Tower coverage of buildable"
          value={towerCoverage}
          onChange={(v) => onPatch({ towerCoverage: v })}
          min={0.1} max={0.9} step={0.01}
        />
        <p className="text-[11px] text-ink-500 leading-relaxed">
          GFA shown below is computed from the actual podium and tower footprints, not the global floor-area override.
        </p>
      </div>
    );
  }

  if (shape === "courtyard") {
    return (
      <div className="grid gap-3">
        <PercentSlider
          label="Courtyard ratio (% of footprint)"
          value={courtyardRatio}
          onChange={(v) => onPatch({ courtyardRatio: v })}
          min={0} max={0.6} step={0.005}
        />
        <p className="text-[11px] text-ink-500 leading-relaxed">
          The "Floor area" below is the net usable area per floor (outer ring minus patio). The outer footprint
          is sized accordingly, capped at the buildable area.
        </p>
      </div>
    );
  }

  if (shape === "twinTowers") {
    return (
      <div className="grid gap-3">
        <Field label="Tower separation (m)">
          <input
            type="number"
            step={0.5}
            min={0}
            className="cell-input text-right"
            value={twinSeparation.toFixed(1)}
            onChange={(e) => onPatch({ twinSeparation: Math.max(0, parseFloat(e.target.value) || 0) })}
          />
        </Field>
        <PercentSlider
          label="Each tower coverage of buildable"
          value={twinCoverage}
          onChange={(v) => onPatch({ twinCoverage: v })}
          min={0.05} max={0.45} step={0.01}
        />
        <p className="text-[11px] text-ink-500 leading-relaxed">
          Two identical towers spaced along the X axis. Increase the separation to reveal a courtyard between them.
        </p>
      </div>
    );
  }

  if (shape === "stepped") {
    return (
      <div className="grid gap-3">
        <Field label={`Steps (max ${effFloors})`}>
          <input
            type="number"
            step={1}
            min={2}
            max={Math.max(2, effFloors)}
            className="cell-input text-right"
            value={steppedSteps}
            onChange={(e) => onPatch({ steppedSteps: Math.max(2, Math.min(effFloors, Math.round(parseFloat(e.target.value) || 2))) })}
          />
        </Field>
        <PercentSlider
          label="Shrink per step"
          value={steppedShrink}
          onChange={(v) => onPatch({ steppedShrink: v })}
          min={0.02} max={0.4} step={0.005}
        />
        <p className="text-[11px] text-ink-500 leading-relaxed">
          Each step is a stack of floors with a footprint reduced by the shrink % from the level below.
          The base step uses the floor area set in Volume.
        </p>
      </div>
    );
  }

  if (shape === "lShape") {
    return (
      <div className="grid gap-3">
        <Field label="Notch corner">
          <select
            className="cell-input"
            value={lNotchPosition}
            onChange={(e) => onPatch({ lNotchPosition: e.target.value as CornerPosition })}
          >
            {CORNER_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <PercentSlider
          label="Notch size (% of bounding box)"
          value={lNotchRatio}
          onChange={(v) => onPatch({ lNotchRatio: v })}
          min={0.1} max={0.55} step={0.01}
        />
      </div>
    );
  }

  if (shape === "uShape") {
    return (
      <div className="grid gap-3">
        <Field label="Open side">
          <select
            className="cell-input"
            value={uOpening}
            onChange={(e) => onPatch({ uOpening: e.target.value as SidePosition })}
          >
            {SIDE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <PercentSlider
          label="Arm thickness"
          value={uArmRatio}
          onChange={(v) => onPatch({ uArmRatio: v })}
          min={0.15} max={0.45} step={0.01}
        />
        <PercentSlider
          label="Notch depth"
          value={uNotchDepth}
          onChange={(v) => onPatch({ uNotchDepth: v })}
          min={0.25} max={0.85} step={0.01}
        />
      </div>
    );
  }

  return null;
}

function PercentSlider({
  label, value, onChange, min, max, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
        <span className="text-[11px] text-ink-700 tabular-nums">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-qube-500"
      />
    </div>
  );
}

function ConstraintsInputs({
  maxFAR,
  maxHeightM,
  currentFAR,
  currentHeight,
  onPatch,
}: {
  maxFAR: number | undefined;
  maxHeightM: number | undefined;
  currentFAR: number;
  currentHeight: number;
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const farOver = maxFAR !== undefined && maxFAR > 0 && currentFAR > maxFAR;
  const heightOver = maxHeightM !== undefined && maxHeightM > 0 && currentHeight > maxHeightM;
  return (
    <div>
      <div className="eyebrow text-ink-500 mb-2">Zoning constraints</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max FAR">
          <input
            type="number"
            step={0.05}
            min={0}
            className="cell-input text-right"
            value={maxFAR ?? ""}
            placeholder="—"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") onPatch({ maxFAR: undefined });
              else {
                const n = parseFloat(raw);
                onPatch({ maxFAR: Number.isFinite(n) && n >= 0 ? n : undefined });
              }
            }}
          />
        </Field>
        <Field label="Max height (m)">
          <input
            type="number"
            step={1}
            min={0}
            className="cell-input text-right"
            value={maxHeightM ?? ""}
            placeholder="—"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") onPatch({ maxHeightM: undefined });
              else {
                const n = parseFloat(raw);
                onPatch({ maxHeightM: Number.isFinite(n) && n >= 0 ? n : undefined });
              }
            }}
          />
        </Field>
      </div>
      {(farOver || heightOver) && (
        <div className="mt-2 text-[11px] text-red-700">
          {farOver && <div>FAR {currentFAR.toFixed(2)} exceeds max {maxFAR}.</div>}
          {heightOver && <div>Height {currentHeight.toFixed(1)} m exceeds max {maxHeightM} m.</div>}
        </div>
      )}
      {!farOver && !heightOver && (maxFAR || maxHeightM) && (
        <div className="mt-2 text-[11px] text-emerald-700">All constraints met.</div>
      )}
    </div>
  );
}

function VolumeInputs({
  effFloors,
  effFloorArea,
  programFloorArea,
  buildableArea,
  hasFloorsOverride,
  hasFloorAreaOverride,
  floorHeight,
  onFloors,
  onFloorArea,
  onMatchProgram,
  onMatchBuildable,
}: {
  effFloors: number;
  effFloorArea: number;
  programFloorArea: number;
  buildableArea: number;
  hasFloorsOverride: boolean;
  hasFloorAreaOverride: boolean;
  floorHeight: number;
  onFloors: (v: number | undefined) => void;
  onFloorArea: (v: number | undefined) => void;
  onMatchProgram: () => void;
  onMatchBuildable: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="eyebrow text-ink-500">Volume</div>
        <div className="flex items-center gap-3">
          <button
            className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900"
            onClick={onMatchProgram}
            title="Reset overrides — match the program (units × interior area / floors)"
          >Match program</button>
          <button
            className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900"
            onClick={onMatchBuildable}
            title="Set floor area = buildable area (max coverage)"
          >Fill buildable</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Floors${hasFloorsOverride ? " *" : ""}`}>
          <div className="relative">
            <input
              type="number"
              step={1}
              min={1}
              className="cell-input text-right pr-7"
              value={effFloors}
              onChange={(e) => {
                const n = Math.max(1, Math.round(parseFloat(e.target.value) || 1));
                onFloors(n);
              }}
            />
            {hasFloorsOverride && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 text-[14px] leading-none"
                onClick={() => onFloors(undefined)}
                title="Reset to project floors"
              >×</button>
            )}
          </div>
        </Field>
        <Field label={`Floor area (m²)${hasFloorAreaOverride ? " *" : ""}`}>
          <div className="relative">
            <input
              type="number"
              step={1}
              min={0}
              className="cell-input text-right pr-7"
              value={Math.round(effFloorArea)}
              onChange={(e) => {
                const n = Math.max(0, parseFloat(e.target.value) || 0);
                onFloorArea(n);
              }}
            />
            {hasFloorAreaOverride && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 text-[14px] leading-none"
                onClick={() => onFloorArea(undefined)}
                title="Reset to program-derived"
              >×</button>
            )}
          </div>
        </Field>
      </div>
      <div className="text-[11px] text-ink-500 mt-2 leading-relaxed">
        Auto values: <span className="tabular-nums">{programFloorArea.toFixed(0)} m²/floor</span> from program,
        max <span className="tabular-nums">{buildableArea.toFixed(0)} m²</span> by buildable.
        Building height = floors × {floorHeight} m. The asterisk marks an override.
      </div>
    </div>
  );
}

function RectangularInputs({
  project, patch, placeholder,
}: {
  project: ReturnType<typeof useProject>;
  patch: (p: Partial<ReturnType<typeof useProject>>) => void;
  placeholder: string;
}) {
  return (
    <>
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
      <div>
        <div className="eyebrow text-ink-500 mb-2">Setbacks (m)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Front">
            <NumInput value={project.setbackFront} onChange={(v) => patch({ setbackFront: v })} step={0.5} />
          </Field>
          <Field label="Rear">
            <NumInput value={project.setbackRear} onChange={(v) => patch({ setbackRear: v })} step={0.5} />
          </Field>
          <Field label="Sides">
            <NumInput value={project.setbackSide} onChange={(v) => patch({ setbackSide: v })} step={0.5} />
          </Field>
        </div>
      </div>
    </>
  );
}

function PolygonInputs({
  vertices, setbackUniform, setbackPerEdge, onSetback, onSetbackPerEdge, onSetbackAll, onUpdate, onAddAfter, onDelete, onRecentre,
}: {
  vertices: Point[];
  setbackUniform: number;
  setbackPerEdge: number[];
  onSetback: (v: number | undefined) => void;
  onSetbackPerEdge: (i: number, v: number) => void;
  onSetbackAll: (v: number) => void;
  onUpdate: (i: number, p: Partial<Point>) => void;
  onAddAfter: (i: number) => void;
  onDelete: (i: number) => void;
  onRecentre: () => void;
}) {
  const lengths = edgeLengths(vertices);
  const perimeter = polygonPerimeter(vertices);

  return (
    <>
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow text-ink-500">Setback per edge (m)</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.5}
              min={0}
              className="cell-input text-right w-16 !py-1 !px-1.5 !text-[11px]"
              value={setbackUniform}
              onChange={(e) => onSetback(parseFloat(e.target.value) || 0)}
              title="Default value used for newly added edges"
            />
            <button
              className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900"
              onClick={() => onSetbackAll(setbackUniform)}
              title="Apply the value above to every edge"
            >Apply to all</button>
          </div>
        </div>
        <div className="border border-ink-200">
          <div className="grid grid-cols-[24px_28px_1fr_72px] gap-1 px-2 py-1.5 text-[10.5px] uppercase tracking-[0.10em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <span></span>
            <span>#</span>
            <span>Length</span>
            <span className="text-right">Setback</span>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {vertices.map((_, i) => {
              const color = edgeColor(i);
              return (
                <div key={i} className="grid grid-cols-[24px_28px_1fr_72px] gap-1 px-2 py-1 items-center border-b border-ink-100 last:border-b-0">
                  <span className="block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-[11px] text-ink-500 tabular-nums">{i + 1}</span>
                  <span className="text-[11px] text-ink-700 tabular-nums">{fmt2(lengths[i] ?? 0)} m</span>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    className="cell-input text-right !py-1 !px-1.5"
                    value={setbackPerEdge[i] ?? 0}
                    onChange={(e) => onSetbackPerEdge(i, parseFloat(e.target.value) || 0)}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
          Each edge of the parcel uses its own setback. The colored swatch matches the edge in the 3D viewer
          and on the reference plan.
        </p>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value, onChange, step = 0.1, placeholder,
}: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      step={step}
      className="cell-input text-right"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        const n = parseFloat(raw);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}

function Stat({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  const cls = bad ? "text-red-700" : good ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-ink-500 text-xs">{label}</span>
      <span className={`font-medium tabular-nums text-right ${cls}`}>
        {value}
        {sub && <span className="block text-[10.5px] text-ink-500 font-normal mt-0.5">{sub}</span>}
      </span>
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
    <details className="group border-t border-ink-200 pt-3" open={defaultOpen}>
      <summary className="cursor-pointer list-none flex items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-ink-500 hover:text-ink-900 transition-colors">
        <span>{title}</span>
        <svg className="w-3 h-3 transition-transform group-open:rotate-180" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="grid gap-4 mt-4">{children}</div>
    </details>
  );
}
