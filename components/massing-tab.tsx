"use client";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BuildingComplex,
  Camera,
  Compass as CompassIcon,
  Footprints,
  ImageDown,
  MapPin,
  Maximize2,
  Pause,
  Play,
  Rotate3d,
  Ruler,
  Sun,
  TreePalm,
  X,
} from "lucide-react";
import { useStore, useProject } from "@/lib/store";
import { fmt2 } from "@/lib/format";
import { renderSchemeWithGemini, DEFAULT_SCHEME_PROMPT, DEFAULT_HYPERREAL_PROMPT } from "@/lib/ai-render";
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
import type { FacadeConfig, TowerFacadeStyle } from "@/lib/types";
import type { CaptureFn, SceneStyle, ViewPresetKind } from "./massing-scene";
import type { FacadeParams as WalkFacadeParams } from "./massing-walk-kit";
import { dubaiDaylight, dubaiSun, formatClock } from "@/lib/sun";
import { projectMetrics, type ProjectMetrics } from "@/lib/metrics";
import { composeBrandedImage, downloadDataUrl, slug } from "@/lib/branded-image";
import { ACCENTS, FACADE_STYLES, GLASSES, resolveFacade, type FacadeParams } from "@/lib/facade";
import { formatLatLng, isInUae, parseLatLng, type LatLng, type SiteContext } from "@/lib/site-context";
import { useSiteContext, type ContextStatus } from "@/lib/use-site-context";

const MassingScene = dynamic(() => import("./massing-scene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-100">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-ink-500 uppercase tracking-[0.18em]">Loading 3D viewer…</div>
      </div>
    </div>
  ),
});

const MassingWalk = dynamic(() => import("./massing-walk"), { ssr: false });

type AiStyle = "scheme" | "hyperreal";
const PROMPT_FOR: Record<AiStyle, string> = {
  scheme: DEFAULT_SCHEME_PROMPT,
  hyperreal: DEFAULT_HYPERREAL_PROMPT,
};

/** Tier colours of the Diagram style — kept in sync with PALETTES.diagram in massing-scene. */
const TIER_SWATCH: Record<NonNullable<Volume["kind"]>, string> = {
  basement: "#9aa3b2",
  ground: "#eb6834",
  podium: "#2a78d6",
  tower: "#1baf7a",
};

/** QUBE logo, as in the header. */
function QubeMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" stroke="#0f7a35" strokeWidth={11} strokeLinejoin="miter" strokeMiterlimit={4} aria-label="QUBE logo">
      <path d="M 8 8 L 72 8 L 92 28 L 92 92 L 28 92 L 8 72 Z" />
    </svg>
  );
}


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

  // Custom tier footprints traced in the Plot tab win over setback-derived
  // outlines — for plots where the tower/podium shape differs from the plot line.
  // Every tier is a LIST of traced blocks; the legacy singular fields count
  // as block #1 so existing projects keep rendering unchanged.
  const customGrounds = useMemo(() => {
    const list = project.groundPolygons ?? (project.groundPolygon ? [project.groundPolygon] : []);
    const valid = list.filter((poly) => (poly?.length ?? 0) >= 3);
    return valid.length > 0 ? valid : null;
  }, [project.groundPolygons, project.groundPolygon]);
  const customPodiums = useMemo(() => {
    const list = project.podiumPolygons ?? (project.podiumPolygon ? [project.podiumPolygon] : []);
    const valid = list.filter((poly) => (poly?.length ?? 0) >= 3);
    return valid.length > 0 ? valid : null;
  }, [project.podiumPolygons, project.podiumPolygon]);
  // Multiple towers: towerPolygons wins; the legacy singular field counts as
  // one tower. Empty/short polygons are dropped.
  const customTowers = useMemo(() => {
    const list = project.towerPolygons ?? (project.towerPolygon ? [project.towerPolygon] : []);
    const valid = list.filter((poly) => (poly?.length ?? 0) >= 3);
    return valid.length > 0 ? valid : null;
  }, [project.towerPolygons, project.towerPolygon]);

  const groundPolys = useMemo(
    () => customGrounds ?? [tierPolygon(plotPoly, groundEdges)],
    [customGrounds, plotPoly, groundEdges],
  );
  const podiumPolys = useMemo(
    () => customPodiums ?? [tierPolygon(plotPoly, podiumEdges)],
    [customPodiums, plotPoly, podiumEdges],
  );
  /** First block of each tier — anchor for amenity clearances and legacy props. */
  const groundPoly = groundPolys[0] ?? [];
  const podiumPoly = podiumPolys[0] ?? [];
  const towerPolysCentered = useMemo(
    () => customTowers ?? [tierPolygon(plotPoly, towerEdges)],
    [customTowers, plotPoly, towerEdges],
  );

  const towerDx = project.towerOffsetXM ?? 0;
  const towerDy = project.towerOffsetYM ?? 0;
  const towerPolys = useMemo(
    () =>
      towerDx === 0 && towerDy === 0
        ? towerPolysCentered
        : towerPolysCentered.map((poly) => translatePolygon(poly, towerDx, towerDy)),
    [towerPolysCentered, towerDx, towerDy],
  );
  /** First tower — anchor for the height dimension and amenity clearances. */
  const towerPoly = towerPolys[0] ?? [];

  const edgeColors = useMemo(
    () => (mode === "polygon" ? plotPoly.map((_, i) => edgeColor(i)) : undefined),
    [mode, plotPoly],
  );

  const plotPolyArea = polygonArea(plotPoly);
  const groundArea = groundPolys.reduce((sum, poly) => sum + polygonArea(poly), 0);
  const podiumArea = podiumPolys.reduce((sum, poly) => sum + polygonArea(poly), 0);
  const towerArea = towerPolys.reduce((sum, poly) => sum + polygonArea(poly), 0);

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
      out.push({ polygon: plotPoly, fromY: -basementH, toY: 0, kind: "basement", floors: basementCount });
      labels.push(basementCount > 1 ? `Basement · ${basementCount}F` : "Basement");
    }
    let y = 0;
    if (groundH > 0) {
      // One label per volume, pushed in the same order as the volumes.
      const gSuffix = groundCount > 1 ? ` · ${groundCount}F` : "";
      groundPolys.forEach((poly, i) => {
        if (poly.length < 3) return;
        out.push({ polygon: poly, fromY: y, toY: y + groundH, kind: "ground", floors: groundCount });
        labels.push(groundPolys.length > 1 ? `Ground ${i + 1}${gSuffix}` : `Ground${gSuffix}`);
      });
      y += groundH;
    }
    if (podiumH > 0) {
      const pSuffix = podiumCount > 1 ? ` · ${podiumCount}F` : "";
      podiumPolys.forEach((poly, i) => {
        if (poly.length < 3) return;
        out.push({ polygon: poly, fromY: y, toY: y + podiumH, kind: "podium", floors: podiumCount });
        labels.push(podiumPolys.length > 1 ? `Podium ${i + 1}${pSuffix}` : `Podium${pSuffix}`);
      });
      y += podiumH;
    }
    if (towerH > 0) {
      towerPolys.forEach((poly, i) => {
        if (poly.length < 3) return;
        out.push({ polygon: poly, fromY: y, toY: y + towerH, kind: "tower", floors: towerCount });
        labels.push(towerPolys.length > 1 ? `Tower ${i + 1} · ${towerCount}F` : `Tower · ${towerCount}F`);
      });
    }
    return { sceneVolumes: out, volumeLabels: labels };
  }, [plotPoly, groundPolys, podiumPolys, towerPolys, basementH, groundH, podiumH, towerH, basementCount, groundCount, podiumCount, towerCount]);

  const totalVolumeGFA = groundArea * groundCount + podiumArea * podiumCount + towerArea * towerCount;
  const computedFar = plotPolyArea > 0 ? totalVolumeGFA / plotPolyArea : 0;

  const captureRef = useRef<CaptureFn | null>(null);

  // Designed façade of the viewer, persisted per project with every default
  // applied. Memoised so the 3D scene only rebuilds the building when it changes.
  const facadeParams: FacadeParams = useMemo(() => resolveFacade(project.facade), [project.facade]);
  // The first-person walk keeps its own façade model (mullion grid, balcony
  // rhythm, precast panels) and shares mode, balconies and fins with the viewer.
  const walkFacade: WalkFacadeParams = useMemo(
    () => ({
      mode: facadeParams.mode,
      panelWidthM: project.facade?.panelWidthM ?? 3.2,
      balconyDepthM: facadeParams.balconyDepthM,
      balconyEveryNBays: project.facade?.balconyEveryNBays ?? 2,
      solidPanelRatio: project.facade?.solidPanelRatio ?? 0.25,
      balconyLayout: project.facade?.balconyLayout ?? "rhythm",
      patternSeed: project.facade?.patternSeed ?? 1,
      groundPodiumTreatment: facadeParams.groundPodiumTreatment,
      finSpacingM: facadeParams.finSpacingM,
      finWidthM: facadeParams.finWidthM,
      finDepthM: facadeParams.finDepthM,
      podiumPool: facadeParams.podiumPool,
      podiumLoungeBbq: facadeParams.podiumLoungeBbq,
    }),
    [facadeParams, project.facade],
  );

  function patchFacade(partial: Partial<FacadeConfig>) {
    patch({ facade: { ...project.facade, ...partial } });
  }

  const [amenityFit, setAmenityFit] = useState({ pool: true, lounge: true });
  const [immersive, setImmersive] = useState(false);
  const [panel, setPanel] = useState<"design" | "scheme" | "site" | "render">("design");

  const metrics = useMemo(() => projectMetrics(project), [project]);
  const northDeg = project.northDeg ?? 0;

  // Real surroundings (OpenStreetMap) around the plot's location.
  const location = project.location;
  const siteContext = project.siteContext;
  const contextRadius = siteContext?.radiusM ?? 400;
  const contextOn = !!siteContext?.enabled && !!location;
  const siteCtx = useSiteContext(location, contextRadius, contextOn);
  const contextState: ContextStatus | "unplaced" = !location ? "unplaced" : contextOn ? siteCtx.status : "off";
  const locationInputRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  const toggleContext = useCallback(() => {
    if (!location) {
      // Nowhere to put the plot yet: take the user to the location field.
      setPanel("site");
      requestAnimationFrame(() => {
        asideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        locationInputRef.current?.focus({ preventScroll: true });
      });
      return;
    }
    patch({ siteContext: { ...siteContext, enabled: !siteContext?.enabled } });
  }, [location, siteContext, patch]);

  const tiersPresent = useMemo(() => {
    const kinds = new Set(sceneVolumes.map((v) => v.kind ?? "tower"));
    return (["tower", "podium", "ground", "basement"] as const).filter((k) => kinds.has(k));
  }, [sceneVolumes]);

  const viewerContext =
    siteCtx.status === "ready" && contextOn && siteCtx.data &&
    siteCtx.data.buildings.length + siteCtx.data.roads.length + siteCtx.data.water.length > 0
      ? siteCtx.data
      : null;


  // ---- AI render (Gemini image-to-image over the studio capture) ----
  const [apiKey, setApiKey] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("qube.gemini.apiKey");
    if (saved) setApiKey(saved);
  }, []);
  const [keyDialog, setKeyDialog] = useState<{ open: boolean; draft: string }>({ open: false, draft: "" });
  const persistKey = useCallback((k: string) => {
    setApiKey(k);
    try { window.localStorage.setItem("qube.gemini.apiKey", k); } catch {}
  }, []);
  const [aiRendering, setAiRendering] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ imageDataUrl: string; note?: string; style: AiStyle } | null>(null);
  const [aiStyle, setAiStyle] = useState<AiStyle>("hyperreal");
  const [aiPrompts, setAiPrompts] = useState<Record<AiStyle, string>>({
    scheme: DEFAULT_SCHEME_PROMPT,
    hyperreal: DEFAULT_HYPERREAL_PROMPT,
  });

  /** Exact storey counts and proportions, prepended to the prompt so the
   *  model doesn't invent floors or warp the silhouette. */
  const geometryFacts = useMemo((): string => {
    const totalAbove = groundCount + podiumCount + towerCount;
    const lines: string[] = [
      "GEOMETRY FACTS (the project building in the input image — preserve EXACTLY):",
      `- ${totalAbove} floors above ground in total.`,
      `- Ground: ${groundCount} floor(s) × ${groundHeightM.toFixed(1)} m height.`,
    ];
    if (podiumCount > 0) {
      lines.push(`- Podium: ${podiumCount} floor(s) × ${podiumHeightM.toFixed(1)} m, sitting on top of the ground.`);
    }
    if (towerPolys.length > 1) {
      lines.push(`- The project has ${towerPolys.length} SEPARATE towers rising from the shared base — keep all of them, in their positions.`);
    }
    if (groundPolys.length > 1 || podiumPolys.length > 1) {
      lines.push(`- The base is made of separate blocks (${groundPolys.length} ground, ${podiumPolys.length} podium) — keep them as distinct volumes, do not merge them into one slab.`);
    }
    lines.push(`- Tower (residential): ${towerCount} typical floor(s) × ${towerHeightM.toFixed(1)} m. Draw exactly ${towerCount} horizontal slab lines / window bands on the tower facade so the viewer can count them.`);
    if (basementCount > 0) {
      lines.push(`- ${basementCount} basement(s) below ground — do NOT show them above ground.`);
    }
    lines.push(`- Total height above ground: ${totalH.toFixed(1)} m.`);
    lines.push(`- Tower footprint area: ${Math.round(towerArea).toLocaleString("en-US")} m².`);
    lines.push("");
    lines.push("CAMERA: reuse the EXACT camera angle, framing, zoom level and crop of the input image. Do not pan, do not zoom, do not change orientation. The project's silhouette in the output must overlay 1:1 with the silhouette in the input.");
    return lines.join("\n");
  }, [groundCount, groundHeightM, podiumCount, podiumHeightM, towerCount, towerHeightM, basementCount, totalH, towerArea, towerPolys.length, groundPolys.length, podiumPolys.length]);

  const handleAiRender = useCallback(async () => {
    if (!apiKey) {
      setKeyDialog({ open: true, draft: "" });
      return;
    }
    const png = await captureRef.current?.();
    if (!png) { setAiError("Could not capture the 3D viewer."); return; }
    const basePrompt = (aiPrompts[aiStyle] ?? PROMPT_FOR[aiStyle]).trim() || PROMPT_FOR[aiStyle];
    const prompt = `${geometryFacts}\n\n${basePrompt}`;
    setAiRendering(true);
    setAiError(null);
    try {
      const out = await renderSchemeWithGemini(apiKey, png, prompt);
      setAiResult({ imageDataUrl: out.imageDataUrl, note: out.textNote, style: aiStyle });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiRendering(false);
    }
  }, [apiKey, aiPrompts, aiStyle, geometryFacts]);

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

  const PANELS = [
    { id: "design", label: "Design" },
    { id: "scheme", label: "Scheme" },
    { id: "site", label: "Site" },
    { id: "render", label: "AI render" },
  ] as const;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Massing study · 3D</h2>
            <p className="section-sub">
              The <strong>basement</strong> fills the plot line; <strong>ground</strong>,{" "}
              <strong>podium</strong> and <strong>tower</strong> follow their per-edge setbacks or the
              footprints traced in Plot. Floor heights come from Setup&apos;s floor breakdown. The
              façade, sun and surroundings are visual only — areas never change.
            </p>
          </div>
          <div className="seg">
            <button className="seg-btn" data-active={mode === "rectangular"} onClick={() => setPlotMode("rectangular")}>
              Rectangular
            </button>
            <button className="seg-btn" data-active={mode === "polygon"} onClick={() => setPlotMode("polygon")}>
              Polygon (irregular)
            </button>
          </div>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
          <div className="grid gap-4 content-start min-w-0">
            <MassingViewer
              projectId={project.id}
              projectName={project.name}
              zone={project.zone}
              plot={plotPoly}
              buildable={towerPoly}
              volumes={sceneVolumes}
              floorHeight={towerHeightM > 0 ? towerHeightM : project.floorHeight}
              showFrontMarker={mode === "rectangular"}
              edgeColors={edgeColors}
              volumeLabels={volumeLabels}
              facade={facadeParams}
              onAmenityFit={setAmenityFit}
              captureRef={captureRef}
              northDeg={northDeg}
              metrics={metrics}
              tiersPresent={tiersPresent}
              context={viewerContext}
              contextRadius={contextRadius}
              contextState={contextState}
              onToggleContext={toggleContext}
              onImmersive={() => setImmersive(true)}
            />

            {project.parcel && !!project.parcel.imageDataUrl && (
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
                  extraPolygons={([
                    ["ground", "#8a9a76", "Ground"],
                    ["podium", "#a17e4c", "Podium"],
                    ["tower", "#3f5135", "Tower"],
                  ] as const).flatMap(([key, color, label]) => {
                    const t = project.parcel!.tierTracesPx;
                    const plural = key === "ground" ? t?.grounds : key === "podium" ? t?.podiums : t?.towers;
                    const single = t?.[key];
                    const list = plural ?? (single ? [single] : []);
                    return list
                      .filter((pts) => pts.length >= 3)
                      .map((pts, i, arr) => ({
                        points: pts,
                        color,
                        label: arr.length > 1 ? `${label} ${i + 1}` : label,
                      }));
                  })}
                />
              </div>
            )}
          </div>

          <aside ref={asideRef} className="border border-ink-200 bg-white xl:sticky xl:top-4 scroll-mt-4 min-w-0">
            <div className="px-4 pt-4 pb-3 border-b border-ink-200 bg-bone-50/60">
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow text-ink-700">Design controls</span>
                <span className="text-[11px] text-ink-500 tabular-nums">
                  {metrics.heightCode} · {totalH.toFixed(1)} m
                </span>
              </div>
              <div className="seg mt-3 w-full grid grid-cols-4" role="tablist" aria-label="Design control groups">
                {PANELS.map((p) => (
                  <button
                    key={p.id}
                    role="tab"
                    aria-selected={panel === p.id}
                    data-active={panel === p.id}
                    className="seg-btn !px-1"
                    onClick={() => setPanel(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 grid gap-4 xl:max-h-[calc(100vh-200px)] xl:overflow-y-auto scroll-thin">
              {panel === "design" && (
                <>
                  <TowerDesignPanel
                    params={facadeParams}
                    onPatch={patchFacade}
                    hasGround={groundH > 0}
                    hasPodium={podiumH > 0}
                    towers={towerPolys.length}
                  />
                  <PodiumAmenitiesPanel
                    hasDeck={podiumH > 0 || groundH > 0}
                    deckKind={podiumH > 0 ? "podium" : "ground"}
                    pool={facadeParams.podiumPool}
                    lounge={facadeParams.podiumLoungeBbq}
                    fit={amenityFit}
                    onPatch={patchFacade}
                  />
                </>
              )}

              {panel === "scheme" && (
                <>
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
                  {(customGrounds || customPodiums || customTowers) && (
                    <div className="border border-qube-200 bg-qube-50 p-3 text-[11.5px] text-ink-800 leading-snug">
                      <div className="eyebrow text-qube-800 text-[10px] mb-1">Custom footprints from Plot</div>
                      {([
                        ["Ground", customGrounds, "ground"],
                        ["Podium", customPodiums, "podium"],
                        ["Tower", customTowers, "tower"],
                      ] as const).map(([label, blocks, tier]) =>
                        blocks ? (
                          <div key={tier} className="flex items-center justify-between gap-2 py-0.5">
                            <span>
                              <strong>
                                {blocks.length === 1 ? label : `${blocks.length} ${label.toLowerCase()} blocks`}
                              </strong>{" "}
                              use{blocks.length === 1 ? "s" : ""} traced footprint{blocks.length === 1 ? "" : "s"}{" "}
                              ({blocks.map((poly) => fmt2(polygonArea(poly))).join(" + ")} m²) — the{" "}
                              {label.toLowerCase()} setbacks are ignored. Add or remove blocks in the Plot tab.
                            </span>
                            <button
                              className="text-[10px] uppercase tracking-[0.10em] text-ink-500 hover:text-red-700 underline shrink-0"
                              onClick={() => {
                                const singular = { ground: "groundPolygon", podium: "podiumPolygon", tower: "towerPolygon" } as const;
                                const plural = { ground: "groundPolygons", podium: "podiumPolygons", tower: "towerPolygons" } as const;
                                const traceKey = { ground: "grounds", podium: "podiums", tower: "towers" } as const;
                                patch({
                                  [singular[tier]]: undefined,
                                  [plural[tier]]: undefined,
                                  parcel: project.parcel
                                    ? {
                                        ...project.parcel,
                                        tierTracesPx: {
                                          ...project.parcel.tierTracesPx,
                                          [tier]: undefined,
                                          [traceKey[tier]]: undefined,
                                        },
                                      }
                                    : project.parcel,
                                });
                              }}
                              title={`Remove every traced ${label.toLowerCase()} block and fall back to setbacks`}
                            >clear</button>
                          </div>
                        ) : null,
                      )}
                    </div>
                  )}
                  <TowerOffset dx={towerDx} dy={towerDy} onPatch={patch} />
                </>
              )}

              {panel === "site" && (
                <>
                  <NorthControl value={northDeg} onChange={(v) => patch({ northDeg: v })} />
                  <SiteContextPanel
                    location={location}
                    enabled={!!siteContext?.enabled}
                    radius={contextRadius}
                    status={contextOn ? siteCtx.status : "off"}
                    error={siteCtx.error}
                    context={siteCtx.data}
                    inputRef={locationInputRef}
                    onLocation={(loc) =>
                      patch({
                        location: loc ?? undefined,
                        // Placing the plot for the first time switches the surroundings on.
                        siteContext: loc && siteContext?.enabled === undefined ? { ...siteContext, enabled: true } : siteContext,
                      })
                    }
                    onEnabled={(v) => patch({ siteContext: { ...siteContext, enabled: v } })}
                    onRadius={(r) => patch({ siteContext: { ...siteContext, radiusM: r } })}
                    onRetry={siteCtx.retry}
                  />
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
                </>
              )}

              {panel === "render" && (
                <div className="border border-ink-200">
                  <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 flex items-center justify-between gap-2">
                    <span className="eyebrow text-ink-500 text-[10px]">AI render · Gemini</span>
                    <div className="seg">
                      {([["scheme", "Schematic"], ["hyperreal", "Hyperreal"]] as const).map(([id, label]) => (
                        <button key={id} className="seg-btn !py-0.5" data-active={aiStyle === id} onClick={() => setAiStyle(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 grid gap-2">
                    <p className="text-[11.5px] text-ink-500 leading-snug">
                      Captures the current 3D view — camera, sun and façade included — and re-renders it
                      keeping the building&apos;s geometry.
                    </p>
                    <button
                      className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-wait"
                      onClick={handleAiRender}
                      disabled={aiRendering}
                      title="Capture the current 3D view and re-render it via Google Gemini"
                    >
                      {aiRendering ? "Rendering…" : "✦ Render current view"}
                    </button>
                    <details>
                      <summary className="cursor-pointer text-[10.5px] uppercase tracking-[0.10em] text-ink-500 hover:text-ink-900">Prompt</summary>
                      <textarea
                        className="cell-input !text-[10.5px] !leading-snug !py-1.5 !px-1.5 font-mono mt-1.5 w-full"
                        rows={6}
                        value={aiPrompts[aiStyle]}
                        onChange={(e) => setAiPrompts((p) => ({ ...p, [aiStyle]: e.target.value }))}
                        spellCheck={false}
                      />
                      {aiPrompts[aiStyle] !== PROMPT_FOR[aiStyle] && (
                        <button
                          className="text-[10px] text-qube-700 hover:text-qube-900 underline mt-1"
                          onClick={() => setAiPrompts((p) => ({ ...p, [aiStyle]: PROMPT_FOR[aiStyle] }))}
                        >Reset to default</button>
                      )}
                    </details>
                    <button
                      className="text-[10px] text-ink-500 hover:text-ink-900 underline justify-self-start"
                      onClick={() => setKeyDialog({ open: true, draft: apiKey })}
                    >
                      {apiKey ? "Replace Gemini key" : "Set Gemini key"}
                    </button>
                    {aiError && (
                      <div className="text-[10px] text-red-700 leading-snug whitespace-pre-wrap">{aiError}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>


      {/* First-person immersive walk */}
      {immersive && (
        <MassingWalk
          plot={plotPoly}
          volumes={sceneVolumes}
          floorHeight={towerHeightM > 0 ? towerHeightM : project.floorHeight}
          facade={walkFacade}
          geometryFacts={geometryFacts}
          onExit={() => setImmersive(false)}
        />
      )}

      {/* Gemini API key dialog */}
      {keyDialog.open && (
        <div className="fixed inset-0 z-50 bg-ink-900/55 flex items-center justify-center p-4">
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
                (free tier includes image generation). Stored only in your browser.
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

      {/* AI render result */}
      {aiResult && (
        <div className="fixed inset-0 z-50 bg-ink-900/65 flex items-center justify-center p-4">
          <div className="bg-white border border-ink-200 shadow-lg max-w-[1100px] w-full max-h-full overflow-auto grid gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow text-ink-500">
                  AI {aiResult.style === "hyperreal" ? "hyperreal" : "schematic"} render
                </div>
                {aiResult.note && (
                  <p className="text-[11px] text-ink-500 mt-1 leading-snug max-w-[700px]">{aiResult.note}</p>
                )}
              </div>
              <button
                className="text-ink-400 hover:text-ink-700 text-[18px] leading-none"
                onClick={() => setAiResult(null)}
                title="Close"
              >×</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={aiResult.imageDataUrl} alt="AI render of the massing" className="w-full h-auto border border-ink-200" />
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.10em] border border-ink-300 text-ink-700 hover:bg-bone-50"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = aiResult.imageDataUrl;
                  a.download = `${project.name.replace(/\s+/g, "-").toLowerCase() || "project"}-ai-${aiResult.style}.png`;
                  a.click();
                }}
              >↓ Download PNG</button>
              <button
                className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50"
                disabled={aiRendering}
                onClick={handleAiRender}
              >{aiRendering ? "Rendering…" : "↻ Re-render"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Viewer                                    */
/* -------------------------------------------------------------------------- */

const STYLES: { id: SceneStyle; label: string; hint: string }[] = [
  { id: "realistic", label: "Realistic", hint: "Dubai daylight with the chosen glass and metal" },
  { id: "model", label: "Model", hint: "White architectural model" },
  { id: "diagram", label: "Diagram", hint: "Colour by tier — basement, ground, podium, tower" },
];

const VIEWS: { id: ViewPresetKind; label: string; hint: string }[] = [
  { id: "aerial", label: "Aerial", hint: "Back to the aerial view" },
  { id: "front", label: "Front", hint: "Street-level view of the front" },
  { id: "top", label: "Top", hint: "Plan view from above" },
];

const SUN_DATES: { label: string; m: number; d: number }[] = [
  { label: "21 Mar", m: 3, d: 21 },
  { label: "21 Jun", m: 6, d: 21 },
  { label: "21 Sep", m: 9, d: 21 },
  { label: "21 Dec", m: 12, d: 21 },
];

const OSM_CREDIT = "© OpenStreetMap contributors";

interface ViewerProps {
  projectId: string;
  projectName: string;
  zone: string;
  plot: Point[];
  buildable: Point[];
  volumes: Volume[];
  floorHeight: number;
  showFrontMarker: boolean;
  edgeColors?: string[];
  volumeLabels: string[];
  facade: FacadeParams;
  onAmenityFit: (fit: { pool: boolean; lounge: boolean }) => void;
  captureRef: React.MutableRefObject<CaptureFn | null>;
  northDeg: number;
  metrics: ProjectMetrics;
  tiersPresent: NonNullable<Volume["kind"]>[];
  /** OpenStreetMap surroundings, when loaded. */
  context: SiteContext | null;
  contextRadius: number;
  contextState: ContextStatus | "unplaced";
  onToggleContext: () => void;
  onImmersive: () => void;
}

const MassingViewer = memo(function MassingViewer(props: ViewerProps) {
  const {
    projectId, projectName, zone, plot, buildable, volumes, floorHeight, showFrontMarker, edgeColors,
    volumeLabels, facade, onAmenityFit, captureRef, northDeg, metrics, tiersPresent,
    context, contextRadius, contextState, onToggleContext, onImmersive,
  } = props;

  const [style, setStyle] = useState<SceneStyle>("realistic");
  const [viewPreset, setViewPreset] = useState<{ kind: ViewPresetKind; nonce: number } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showPlanting, setShowPlanting] = useState(true);
  const [present, setPresent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const compassRef = useRef<HTMLDivElement>(null);

  // Sun study — Dubai, a chosen day and hour.
  const year = new Date().getFullYear();
  const [sunOn, setSunOn] = useState(true);
  const [sunDate, setSunDate] = useState({ m: 3, d: 21 });
  const [hour, setHour] = useState(14);
  const [playing, setPlaying] = useState(false);
  const daylight = useMemo(() => dubaiDaylight(year, sunDate.m, sunDate.d), [year, sunDate]);
  const clampedHour = Math.min(daylight.sunset - 0.05, Math.max(daylight.sunrise + 0.05, hour));
  const sun = useMemo(
    () => (sunOn ? dubaiSun(year, sunDate.m, sunDate.d, clampedHour) : null),
    [sunOn, year, sunDate, clampedHour],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      // ~12 s for a whole day, updated at ~24 fps.
      if (acc > 40) {
        const step = ((daylight.sunset - daylight.sunrise) / 12000) * acc;
        acc = 0;
        setHour((h) => {
          const next = Math.max(h, daylight.sunrise) + step;
          return next >= daylight.sunset - 0.05 ? daylight.sunrise + 0.05 : next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, daylight]);

  // Presentation mode: Esc exits, and the page behind stops scrolling.
  useEffect(() => {
    if (!present) return;
    document.body.classList.add("present-open");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresent(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("present-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [present]);

  function flyTo(kind: ViewPresetKind) {
    setAutoRotate(false);
    setViewPreset((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const stats: Array<[string, string]> = useMemo(() => {
    const out: Array<[string, string]> = [];
    if (metrics.totalGFA > 0) out.push(["GFA", `${Math.round(metrics.totalGFA).toLocaleString("en-US")} m²`]);
    if (metrics.units > 0) out.push(["Units", metrics.units.toLocaleString("en-US")]);
    out.push(["Height", `${metrics.heightCode} · ${metrics.heightM.toFixed(0)} m`]);
    if (metrics.far !== null) out.push(["FAR", metrics.far.toFixed(2)]);
    if (metrics.gsa > 0) out.push(["Sellable", `${Math.round(metrics.gsa).toLocaleString("en-US")} m²`]);
    return out;
  }, [metrics]);

  async function exportImage() {
    const cap = captureRef.current;
    if (!cap || exporting) return;
    setExporting(true);
    try {
      const shot = await cap({ scale: 2 });
      if (!shot) return;
      const when = sun
        ? ` · sun ${SUN_DATES.find((d) => d.m === sunDate.m && d.d === sunDate.d)?.label ?? ""} ${formatClock(clampedHour)}`
        : "";
      const exportStats: Array<[string, string]> = [];
      if (metrics.totalGFA > 0) exportStats.push(["GFA", `${Math.round(metrics.totalGFA).toLocaleString("en-US")} m²`]);
      if (metrics.units > 0) exportStats.push(["Units", metrics.units.toLocaleString("en-US")]);
      exportStats.push(["Height", `${metrics.heightM.toFixed(0)} m`]);
      if (metrics.far !== null) exportStats.push(["FAR", metrics.far.toFixed(2)]);
      const img = await composeBrandedImage(shot, {
        title: projectName || "Untitled project",
        subtitle: `${zone || "Dubai"} · ${metrics.heightCode} · massing study${when}`,
        stats: exportStats,
        brand: "QUBE",
        tagline: "QUBE Development · Plot feasibility",
        attribution: context ? `Surroundings ${OSM_CREDIT}` : undefined,
      });
      downloadDataUrl(img, `${slug(projectName)}-massing.png`);
    } finally {
      setExporting(false);
    }
  }

  const toolBtn =
    "inline-flex items-center gap-1.5 h-8 px-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors whitespace-nowrap";
  const glass = "bg-white/90 backdrop-blur-md border border-ink-200 shadow-sm";
  const on = "bg-ink-900 text-bone-100";
  const off = "text-ink-700 hover:bg-bone-200/70";

  return (
    <div
      className={
        present
          ? "fixed inset-0 z-[70] bg-ink-900"
          : "relative overflow-hidden border border-ink-200 bg-bone-100 aspect-[3/4] sm:aspect-[4/3] xl:aspect-auto xl:h-[calc(100vh-345px)] xl:min-h-[540px] xl:max-h-[820px]"
      }
    >
      <MassingScene
        plot={plot}
        buildable={buildable}
        volumes={volumes}
        primaryFootprint={buildable}
        floorHeight={floorHeight}
        showFrontMarker={showFrontMarker}
        edgeColors={edgeColors}
        volumeLabels={volumeLabels}
        showAnnotations={showAnnotations && !present}
        viewPreset={viewPreset}
        autoRotate={autoRotate}
        captureRef={captureRef}
        facade={facade}
        onAmenityFit={onAmenityFit}
        style={style}
        sun={sun}
        northDeg={northDeg}
        showPlanting={showPlanting}
        quality={present ? "high" : "standard"}
        compassRef={compassRef}
        frameKey={projectId}
        context={context}
        contextRadius={contextRadius}
      />

      {/* Top-left: style + legend */}
      <div className="absolute z-20 top-3 left-3 grid gap-2 justify-items-start max-w-[calc(100%-24px)]">
        {present && (
          <div className={`${glass} px-4 py-3 flex items-center gap-3`}>
            <QubeMark className="w-8 h-8 shrink-0" />
            <div className="min-w-0">
              <div className="text-[16px] font-medium text-ink-900 truncate max-w-[46vw]">{projectName}</div>
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500 truncate">{zone} · QUBE massing study</div>
            </div>
          </div>
        )}
        <div className={`${glass} p-0.5 inline-flex gap-0.5`} role="radiogroup" aria-label="Viewer style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={style === s.id}
              onClick={() => setStyle(s.id)}
              title={s.hint}
              className={`${toolBtn} !h-7 ${style === s.id ? on : off}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {style === "diagram" && (
          <div className={`${glass} px-2.5 py-2 grid gap-1`} aria-label="Legend">
            {tiersPresent.map((k) => (
              <div key={k} className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-700">
                <span className="w-2.5 h-2.5" style={{ background: TIER_SWATCH[k], opacity: k === "basement" ? 0.6 : 1 }} />
                {k === "tower" ? "Tower · residential" : k}
              </div>
            ))}
          </div>
        )}
        {contextState === "loading" && (
          <div className={`${glass} px-2.5 py-1.5 flex items-center gap-2 text-[11px] text-ink-700`} role="status">
            <span className="w-3 h-3 border-2 border-qube-500 border-t-transparent rounded-full animate-spin" />
            Loading surroundings…
          </div>
        )}
        {contextState === "error" && (
          <div className={`${glass} px-2.5 py-1.5 text-[11px] text-amber-800`} role="status">
            Surroundings unavailable — retry in Site
          </div>
        )}
      </div>

      {/* OpenStreetMap credit, required wherever its data is shown */}
      {context && (
        <div className="absolute z-10 right-3 top-[52px] px-1.5 py-0.5 bg-white/75 text-[10px] text-ink-500 pointer-events-auto">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:underline">
            {OSM_CREDIT}
          </a>
        </div>
      )}

      {/* Top-right: camera */}
      <div className="absolute z-20 top-3 right-3 flex items-center gap-2">
        <div className={`${glass} p-0.5 inline-flex gap-0.5`} role="group" aria-label="Camera views">
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => flyTo(v.id)} className={`${toolBtn} !h-7 ${off}`} title={v.hint}>
              {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAutoRotate((v) => !v)}
          className={`${toolBtn} ${glass} ${autoRotate ? "!bg-ink-900 text-bone-100" : off}`}
          title="Turntable rotation"
          aria-pressed={autoRotate}
        >
          <Rotate3d className="w-4 h-4" />
        </button>
        {present && (
          <button onClick={() => setPresent(false)} className={`${toolBtn} ${glass} ${off}`} title="Exit presentation (Esc)">
            <X className="w-4 h-4" /> Exit
          </button>
        )}
      </div>

      {/* Bottom: compass + sun study + actions */}
      <div className="absolute z-20 left-3 right-3 bottom-3 grid gap-2 sm:flex sm:flex-wrap sm:items-end">
        <div className={`${glass} order-1 sm:order-2 px-3 py-2 grid gap-1.5 sm:flex sm:items-center sm:gap-3 min-w-0 sm:min-w-[440px]`}>
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setSunOn((v) => !v)}
              className={`w-8 h-8 grid place-items-center shrink-0 ${sunOn ? "bg-sand-100 text-sand-700 border border-sand-300" : "text-ink-400 hover:bg-bone-200/70"}`}
              title={sunOn ? "Sun & shadow study on — Dubai" : "Turn the Dubai sun & shadow study on"}
              aria-pressed={sunOn}
            >
              <Sun className="w-4 h-4" />
            </button>
            {sunOn ? (
              <>
                <div className="flex items-center gap-0.5 sm:gap-1" role="radiogroup" aria-label="Day of the year">
                  {SUN_DATES.map((d) => {
                    const active = d.m === sunDate.m && d.d === sunDate.d;
                    return (
                      <button
                        key={d.label}
                        role="radio"
                        aria-checked={active}
                        aria-label={d.label}
                        onClick={() => setSunDate({ m: d.m, d: d.d })}
                        className={`h-7 px-1.5 sm:px-2 text-[10.5px] font-medium uppercase tracking-[0.06em] whitespace-nowrap ${active ? on : "text-ink-600 hover:bg-bone-200/70"}`}
                      >
                        <span className="sm:hidden">{d.label.split(" ")[1]}</span>
                        <span className="hidden sm:inline">{d.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="sm:hidden ml-auto text-right leading-tight shrink-0">
                  <div className="text-[13px] font-medium text-ink-900 tabular-nums">{formatClock(clampedHour)}</div>
                </div>
              </>
            ) : (
              <span className="text-[11px] text-ink-500 pr-2">Sun study off — studio light</span>
            )}
          </div>
          {sunOn && (
            <div className="flex items-center gap-2 flex-1 min-w-0 sm:min-w-[180px]">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="w-7 h-7 grid place-items-center text-ink-700 hover:bg-bone-200/70 shrink-0"
                title={playing ? "Pause the day" : "Play the day — sunrise to sunset"}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={Math.ceil(daylight.sunrise * 12) / 12}
                max={Math.floor(daylight.sunset * 12) / 12}
                step={1 / 12}
                value={clampedHour}
                onChange={(e) => {
                  setPlaying(false);
                  setHour(parseFloat(e.target.value));
                }}
                className="flex-1 accent-[#a17e4c] min-w-[80px]"
                aria-label="Time of day"
              />
              <div className="text-right leading-tight shrink-0 w-[70px] sm:w-[92px]">
                <div className="hidden sm:block text-[13px] font-medium text-ink-900 tabular-nums">{formatClock(clampedHour)}</div>
                <div className="text-[10px] text-ink-500 tabular-nums whitespace-nowrap">
                  {sun ? `alt ${sun.altitudeDeg.toFixed(0)}° · az ${sun.azimuthDeg.toFixed(0)}°` : ""}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="order-2 flex items-end justify-between gap-2 sm:contents">
          <div className={`${glass} sm:order-1 w-11 h-11 rounded-full grid place-items-center shrink-0`} title="North">
            <div ref={compassRef} className="w-8 h-8 relative" aria-label="North arrow">
              <svg viewBox="0 0 32 32" className="w-8 h-8">
                <path d="M16 3 L20 16 L16 14 L12 16 Z" fill="#506646" />
                <path d="M16 29 L12 16 L16 18 L20 16 Z" fill="#c9c4b9" />
              </svg>
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-qube-700">N</span>
            </div>
          </div>

          <div className={`${glass} sm:order-3 p-1 flex items-center gap-0.5 sm:ml-auto`}>
            <button
              onClick={() => setShowAnnotations((v) => !v)}
              className={`${toolBtn} ${showAnnotations ? "text-qube-800 bg-qube-50" : off}`}
              title="Height dimension and tier labels"
              aria-label="Dimensions and labels"
              aria-pressed={showAnnotations}
            >
              <Ruler className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowPlanting((v) => !v)}
              className={`${toolBtn} ${showPlanting ? "text-qube-800 bg-qube-50" : off}`}
              title="Street trees and palms"
              aria-label="Street trees and palms"
              aria-pressed={showPlanting}
            >
              <TreePalm className="w-4 h-4" />
            </button>
            <button
              onClick={onToggleContext}
              className={`${toolBtn} ${
                contextState === "ready" || contextState === "loading" ? "text-qube-800 bg-qube-50" : off
              }`}
              title={
                contextState === "unplaced"
                  ? "Neighbouring buildings — add the plot location in Site first"
                  : "Neighbouring buildings, streets and water (OpenStreetMap)"
              }
              aria-label="Neighbouring buildings"
              aria-pressed={contextState === "ready" || contextState === "loading"}
            >
              <BuildingComplex className="w-4 h-4" />
            </button>
            <button onClick={() => void exportImage()} className={`${toolBtn} ${off}`} title="Download a presentation image (PNG)" aria-label="Download image" disabled={exporting}>
              {exporting ? <Camera className="w-4 h-4 animate-pulse" /> : <ImageDown className="w-4 h-4" />}
              <span className="hidden md:inline">Image</span>
            </button>
            {!present && (
              <>
                <button
                  onClick={onImmersive}
                  className={`${toolBtn} ${off}`}
                  title="Walk around the building in first person — WASD + mouse"
                  aria-label="Immersive walk"
                >
                  <Footprints className="w-4 h-4" />
                  <span className="hidden md:inline">Walk</span>
                </button>
                <button onClick={() => setPresent(true)} className={`${toolBtn} bg-qube-600 text-white hover:bg-qube-700`} title="Full-screen presentation mode" aria-label="Present">
                  <Maximize2 className="w-4 h-4" />
                  <span className="hidden md:inline">Present</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Presentation KPI band */}
      {present && (
        <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-[132px] sm:bottom-[76px] max-w-[calc(100%-24px)]">
          <div className={`${glass} px-2 py-2 flex items-stretch overflow-x-auto no-scrollbar`}>
            {stats.map(([label, value]) => (
              <div key={label} className="px-4 py-1 border-r last:border-r-0 border-ink-200 min-w-[120px]">
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-500 font-medium whitespace-nowrap">{label}</div>
                <div className="text-[18px] font-medium text-ink-900 whitespace-nowrap tracking-tight tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                              Inspector panels                              */
/* -------------------------------------------------------------------------- */

function NorthControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="flex items-center gap-2">
          <CompassIcon className="w-4 h-4 text-ink-400" /> True north
        </span>
        <span className="text-[11px] text-ink-500 tabular-nums normal-case tracking-normal">{value.toFixed(0)}°</span>
      </div>
      <div className="p-3 grid gap-2">
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full accent-[#506646]"
          aria-label="True north bearing"
        />
        <p className="text-[11px] text-ink-500 leading-snug">
          Bearing of true north, clockwise from the top of the plot drawing. Copy it from the north arrow on the
          affection plan (0° = drawing is north-up). It orients the sun & shadow study and the surroundings.
        </p>
      </div>
    </div>
  );
}

const RADII = [250, 400, 600];

function SiteContextPanel({
  location, enabled, radius, status, error, context, inputRef, onLocation, onEnabled, onRadius, onRetry,
}: {
  location: LatLng | undefined;
  enabled: boolean;
  radius: number;
  status: ContextStatus;
  error?: string;
  context: SiteContext | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onLocation: (loc: LatLng | null) => void;
  onEnabled: (v: boolean) => void;
  onRadius: (r: number) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState(location ? formatLatLng(location) : "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(location ? formatLatLng(location) : "");
    setInvalid(false);
  }, [location]);

  function commit() {
    const text = draft.trim();
    if (!text) {
      if (location) onLocation(null);
      setInvalid(false);
      return;
    }
    const loc = parseLatLng(text);
    if (!loc) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (!location || loc.lat !== location.lat || loc.lng !== location.lng) onLocation(loc);
    else setDraft(formatLatLng(loc));
  }

  const estimated = context?.buildings.filter((b) => b.estimated).length ?? 0;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-ink-400" /> Location & surroundings
        </span>
      </div>
      <div className="p-3 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-[10.5px] uppercase tracking-[0.10em] font-medium text-ink-500">Plot location</span>
          <input
            ref={inputRef}
            className={`cell-input ${invalid ? "!border-red-400" : ""}`}
            value={draft}
            placeholder="25.18650, 55.26400 or a Google Maps link"
            spellCheck={false}
            inputMode="text"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            aria-invalid={invalid}
          />
          {invalid ? (
            <span className="text-[11px] text-red-700">
              Not a location — paste coordinates like 25.18650, 55.26400 or a Google Maps link.
            </span>
          ) : (
            <span className="text-[11px] text-ink-500 leading-snug">
              In Google Maps, right-click the middle of the plot and click the coordinates to copy them.
            </span>
          )}
        </label>
        {location && !isInUae(location) && (
          <p className="text-[11px] text-amber-800 leading-snug -mt-1">
            These coordinates are outside the UAE — check that the latitude comes first.
          </p>
        )}
        {location && (
          <a
            href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11.5px] font-medium text-qube-700 hover:text-qube-900 justify-self-start -mt-1"
          >
            Check it on Google Maps ↗
          </a>
        )}

        <div className="panel divide-y divide-ink-100">
          <ToggleRow
            label="Neighbouring buildings"
            hint="Buildings, streets and water from OpenStreetMap"
            checked={enabled && !!location}
            disabled={!location}
            onChange={onEnabled}
          />
          <div className={`px-3 py-2.5 flex items-center justify-between gap-3 ${enabled && location ? "" : "opacity-45"}`}>
            <span className="text-[12px] font-medium text-ink-900">Radius</span>
            <div className="seg">
              {RADII.map((r) => (
                <button
                  key={r}
                  className="seg-btn !py-0.5"
                  data-active={radius === r}
                  disabled={!enabled || !location}
                  onClick={() => onRadius(r)}
                >
                  {r} m
                </button>
              ))}
            </div>
          </div>
        </div>

        {status === "loading" && (
          <div className="flex items-center gap-2 text-[11.5px] text-ink-600" role="status">
            <span className="w-3.5 h-3.5 border-2 border-qube-500 border-t-transparent rounded-full animate-spin" />
            Loading OpenStreetMap…
          </div>
        )}
        {status === "ready" && context && (
          <p className="text-[11.5px] text-ink-700 leading-snug" role="status">
            {context.buildings.length.toLocaleString("en-US")} buildings · {context.roads.length.toLocaleString("en-US")} streets
            {context.water.length > 0 ? " · water" : ""}
            {estimated > 0 && (
              <span className="text-ink-500"> — {estimated.toLocaleString("en-US")} without a height in OpenStreetMap, shown at a typical height</span>
            )}
          </p>
        )}
        {status === "error" && (
          <div className="flex items-start justify-between gap-3 bg-amber-50 border border-amber-200 px-3 py-2">
            <span className="text-[11.5px] text-amber-900 leading-snug">{error || "OpenStreetMap is not responding."}</span>
            <button className="btn btn-secondary btn-xs shrink-0" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        <p className="text-[11px] text-ink-500 leading-snug">
          The plot centre goes on these coordinates, turned by True north above. Buildings standing on the plot are
          left out. Map data{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-ink-800">
            © OpenStreetMap contributors
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Mini elevation of a façade concept, in the chosen glass and metal. */
function FacadePictogram({ style, glass, accent }: { style: TowerFacadeStyle; glass: string; accent: string }) {
  const sky = "#eef1ec";
  const white = "#ffffff";
  const x0 = 40;
  const x1 = 80;
  const top = 8;
  const bottom = 58;
  const rows = Array.from({ length: 8 }, (_, i) => top + 6 + i * 6.2);
  const cols = (step: number) => Array.from({ length: Math.floor((x1 - x0) / step) + 1 }, (_, i) => x0 + i * step);
  return (
    <svg viewBox="0 0 120 64" className="w-full h-14" aria-hidden>
      <rect width="120" height="64" fill={sky} />
      <rect x="0" y="58" width="120" height="6" fill="#dcd6c8" />
      <rect x={x0} y={top} width={x1 - x0} height={bottom - top} rx={style === "frame" ? 1 : 5} fill={glass} />
      {style === "balconies" &&
        rows.map((y) => (
          <g key={y}>
            <rect x={x0 - 4} y={y} width={x1 - x0 + 8} height={1.8} rx={0.9} fill={white} />
            <rect x={x0 - 4} y={y - 2.4} width={x1 - x0 + 8} height={0.8} fill={accent} />
          </g>
        ))}
      {style === "curtain" && (
        <>
          {rows.map((y) => (
            <rect key={y} x={x0} y={y} width={x1 - x0} height={1.6} fill={mix(glass, "#0e0e0e", 0.45)} />
          ))}
          {cols(4).map((x, i) => (
            <rect key={x} x={x - (i % 4 === 0 ? 0.9 : 0.3)} y={top} width={i % 4 === 0 ? 1.8 : 0.6} height={bottom - top} fill={i % 4 === 0 ? accent : white} opacity={i % 4 === 0 ? 1 : 0.55} />
          ))}
        </>
      )}
      {style === "fins" && (
        <>
          {rows.map((y) => (
            <rect key={y} x={x0} y={y} width={x1 - x0} height={0.9} fill={white} opacity={0.85} />
          ))}
          {cols(4.4).map((x, i) => (
            <rect key={x} x={x - 0.9} y={top} width={1.8 + 0.9 * Math.abs(Math.sin(i * 0.7))} height={bottom - top} fill={accent} />
          ))}
        </>
      )}
      {style === "frame" && (
        <>
          {cols(3.3).map((x) => (
            <rect key={x} x={x - 0.25} y={top} width={0.5} height={bottom - top} fill={white} opacity={0.5} />
          ))}
          {[top, ...rows.filter((_, i) => i % 2 === 1)].map((y) => (
            <rect key={y} x={x0 - 1.5} y={y} width={x1 - x0 + 3} height={2.4} fill={accent} />
          ))}
          {cols(10).map((x) => (
            <rect key={`p${x}`} x={x - 1.3} y={top} width={2.6} height={bottom - top} fill={accent} />
          ))}
        </>
      )}
      {/* crown */}
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={x0 + 1 + i * 4.75} y={2.5} width={0.9} height={top - 2.5} fill={accent} />
      ))}
      <rect x={x0} y={2} width={x1 - x0} height={1.2} fill={accent} />
    </svg>
  );
}

function SwatchRow<K extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: K;
  options: { id: K; label: string; swatch: string }[];
  onChange: (id: K) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-[0.10em] font-medium text-ink-500">{label}</span>
        <span className="text-[11.5px] font-medium text-ink-900">{current?.label}</span>
      </div>
      <div className="flex items-center gap-2.5" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={o.label}
              title={o.label}
              onClick={() => onChange(o.id)}
              className={`w-8 h-8 rounded-full grid place-items-center transition-shadow ${
                active ? "ring-2 ring-qube-500 ring-offset-2" : "ring-1 ring-ink-200 hover:ring-ink-400"
              }`}
            >
              <span
                className="w-6 h-6 rounded-full"
                style={{
                  background: `linear-gradient(145deg, ${mix(o.swatch, "#ffffff", 0.45)} 0%, ${o.swatch} 55%, ${mix(o.swatch, "#000000", 0.25)} 100%)`,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, disabled, onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bone-50 transition-colors disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] font-medium text-ink-900">{label}</span>
        <span className="block text-[11px] text-ink-500 leading-snug">{hint}</span>
      </span>
      <span className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${checked && !disabled ? "bg-qube-600" : "bg-ink-200"}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}

function TowerDesignPanel({
  params, onPatch, hasGround, hasPodium, towers,
}: {
  params: FacadeParams;
  onPatch: (p: Partial<FacadeConfig>) => void;
  hasGround: boolean;
  hasPodium: boolean;
  towers: number;
}) {
  const designed = params.mode === "residential";
  const glass = GLASSES[params.glass].swatch;
  const accent = ACCENTS[params.accent].swatch;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-ink-700">Tower façade</span>
        <div className="seg">
          <button className="seg-btn !py-0.5" data-active={designed} onClick={() => onPatch({ mode: "residential" })}>
            Designed
          </button>
          <button
            className="seg-btn !py-0.5"
            data-active={!designed}
            onClick={() => onPatch({ mode: "massing" })}
            title="Plain tier volumes with floor lines"
          >
            Plain massing
          </button>
        </div>
      </div>

      <div className={`grid gap-4 transition-opacity ${designed ? "" : "opacity-40 pointer-events-none select-none"}`} aria-disabled={!designed}>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Façade concept">
          {FACADE_STYLES.map((f) => {
            const active = params.style === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onPatch({ style: f.id, mode: "residential" })}
                className={`text-left p-2 transition-shadow bg-white border ${
                  active ? "border-qube-500 ring-1 ring-qube-500 shadow-sm" : "border-ink-200 hover:border-ink-400"
                }`}
              >
                <FacadePictogram style={f.id} glass={glass} accent={accent} />
                <span className="block mt-2 px-0.5 text-[12px] font-medium text-ink-900 leading-tight">{f.label}</span>
                <span className="block px-0.5 mt-0.5 text-[10.5px] text-ink-500 leading-snug">{f.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <SwatchRow
            label="Glass"
            value={params.glass}
            options={(Object.keys(GLASSES) as (keyof typeof GLASSES)[]).map((id) => ({ id, label: GLASSES[id].label, swatch: GLASSES[id].swatch }))}
            onChange={(id) => onPatch({ glass: id })}
          />
          <SwatchRow
            label="Metal"
            value={params.accent}
            options={(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((id) => ({ id, label: ACCENTS[id].label, swatch: ACCENTS[id].swatch }))}
            onChange={(id) => onPatch({ accent: id })}
          />
        </div>

        {params.style === "balconies" && (
          <label className="grid gap-1.5">
            <span className="flex items-baseline justify-between">
              <span className="text-[10.5px] uppercase tracking-[0.10em] font-medium text-ink-500">Balcony depth</span>
              <span className="text-[11.5px] font-medium text-ink-900 tabular-nums">{params.balconyDepthM.toFixed(1)} m</span>
            </span>
            <input
              type="range"
              min={1.2}
              max={3.5}
              step={0.1}
              value={params.balconyDepthM}
              onChange={(e) => onPatch({ balconyDepthM: parseFloat(e.target.value) })}
              className="w-full accent-[#506646]"
            />
          </label>
        )}

        <div className="panel divide-y divide-ink-100">
          <ToggleRow
            label="Rounded corners"
            hint="Soft, sculpted tower corners"
            checked={params.roundedCorners}
            onChange={(v) => onPatch({ roundedCorners: v })}
          />
          <ToggleRow
            label="Crown & sky pool"
            hint={towers > 1 ? "Crown screen over a rooftop pool and lounge on each tower" : "Crown screen over a rooftop pool and lounge"}
            checked={params.crown}
            onChange={(v) => onPatch({ crown: v })}
          />
          <ToggleRow
            label="Lobby & entrance canopy"
            hint="Glazed ground floor with a drop-off canopy"
            checked={params.entrance}
            disabled={!hasGround}
            onChange={(v) => onPatch({ entrance: v })}
          />
          <ToggleRow
            label="Podium screen"
            hint="Metal fins screening the podium car park"
            checked={params.groundPodiumTreatment === "fins"}
            disabled={!hasPodium}
            onChange={(v) => onPatch({ groundPodiumTreatment: v ? "fins" : "massing" })}
          />
        </div>
      </div>

      <p className="text-[11px] text-ink-500 leading-snug">
        Visual only — areas and ratios never change. The Diagram style shows plain tier colours.
      </p>
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


function PodiumAmenitiesPanel({
  hasDeck, deckKind, pool, lounge, fit, onPatch,
}: {
  hasDeck: boolean;
  deckKind: "podium" | "ground";
  pool: boolean;
  lounge: boolean;
  fit: { pool: boolean; lounge: boolean };
  onPatch: (p: { podiumPool?: boolean; podiumLoungeBbq?: boolean }) => void;
}) {
  const deckLabel = deckKind === "podium" ? "podium" : "ground floor";
  return (
    <div className="border border-ink-200">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200">
        <span className="eyebrow text-ink-500 text-[10px]">Roof amenities</span>
      </div>
      <div className="p-3 grid gap-2">
        <label className={`flex items-center gap-2 text-[12px] ${hasDeck ? "text-ink-900" : "text-ink-400"}`}>
          <input
            type="checkbox"
            checked={pool}
            disabled={!hasDeck}
            onChange={(e) => onPatch({ podiumPool: e.target.checked })}
          />
          Swimming pool
        </label>
        {pool && hasDeck && !fit.pool && (
          <p className="text-[10.5px] text-amber-700 leading-snug pl-5 -mt-1">
            No room on the {deckLabel} deck for a pool — the ring between the tower and the {deckLabel}
            edge is too narrow. Increase Tower setback or reduce {deckKind === "podium" ? "Podium" : "Ground"} setback per edge above.
          </p>
        )}
        <label className={`flex items-center gap-2 text-[12px] ${hasDeck ? "text-ink-900" : "text-ink-400"}`}>
          <input
            type="checkbox"
            checked={lounge}
            disabled={!hasDeck}
            onChange={(e) => onPatch({ podiumLoungeBbq: e.target.checked })}
          />
          Lounge &amp; BBQ terrace
        </label>
        {lounge && hasDeck && !fit.lounge && (
          <p className="text-[10.5px] text-amber-700 leading-snug pl-5 -mt-1">
            No room on the {deckLabel} deck for a lounge terrace — same fix: widen the ring by
            adjusting the Tower / {deckKind === "podium" ? "Podium" : "Ground"} setbacks per edge above.
          </p>
        )}
        <p className="text-[10.5px] text-ink-500 leading-snug">
          {hasDeck
            ? `Placed on the ${deckLabel} roof ring exposed once the (further set back) tower rises above it — only if there is enough clear depth. Uses the Podium deck when there is one, otherwise the Ground floor roof.`
            : "Add ground or podium floors in Setup → Floor breakdown to unlock roof amenities."}
        </p>
      </div>
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

/**
 * Decimal input backed by its own text state, decoupled from the numeric
 * prop. A plain controlled `<input value={num}>` re-snaps to the last valid
 * number on every keystroke that fails the `min` check — which blocks typing
 * any value below `min` digit-by-digit (e.g. "0.5" with min=0.03: the
 * intermediate "0" fails 0 >= 0.03, so onChange is never called and the field
 * reverts before "." or "5" can be typed). Keeping local text lets the user
 * type freely; the parent only hears about it once the string parses to a
 * valid number, and the field only snaps back to the last good value on blur.
 */
function DecimalField({
  label, value, onChange, step = 0.1, min = 0, title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    const parsed = parseFloat(text);
    if (!Number.isFinite(parsed) || parsed !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Field label={label}>
      <input
        type="number"
        step={step}
        min={min}
        className="cell-input text-right"
        value={text}
        title={title}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = parseFloat(raw);
          if (Number.isFinite(n) && n >= min) onChange(n);
        }}
        onBlur={() => {
          const n = parseFloat(text);
          if (!Number.isFinite(n) || n < min) setText(String(value));
        }}
      />
    </Field>
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
