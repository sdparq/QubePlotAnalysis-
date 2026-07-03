"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type AiStyle = "scheme" | "hyperreal";
const PROMPT_FOR: Record<AiStyle, string> = {
  scheme: DEFAULT_SCHEME_PROMPT,
  hyperreal: DEFAULT_HYPERREAL_PROMPT,
};

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

  const [viewPreset, setViewPreset] = useState<{ kind: "iso" | "front" | "top"; nonce: number } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const captureRef = useRef<(() => string) | null>(null);

  // Facade parameters, persisted per project with sensible defaults.
  const facadeParams = {
    mode: project.facade?.mode ?? "massing",
    panelWidthM: project.facade?.panelWidthM ?? 3.2,
    balconyDepthM: project.facade?.balconyDepthM ?? 1.8,
    balconyEveryNBays: project.facade?.balconyEveryNBays ?? 2,
    solidPanelRatio: project.facade?.solidPanelRatio ?? 0.25,
    balconyLayout: project.facade?.balconyLayout ?? "rhythm",
    patternSeed: project.facade?.patternSeed ?? 1,
  } as const;

  function patchFacade(partial: Partial<NonNullable<typeof project.facade>>) {
    patch({ facade: { ...project.facade, ...partial } });
  }

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
    lines.push(`- Tower (residential): ${towerCount} typical floor(s) × ${towerHeightM.toFixed(1)} m. Draw exactly ${towerCount} horizontal slab lines / window bands on the tower facade so the viewer can count them.`);
    if (basementCount > 0) {
      lines.push(`- ${basementCount} basement(s) below ground — do NOT show them above ground.`);
    }
    lines.push(`- Total height above ground: ${totalH.toFixed(1)} m.`);
    lines.push(`- Tower footprint area: ${Math.round(towerArea).toLocaleString("en-US")} m².`);
    lines.push("");
    lines.push("CAMERA: reuse the EXACT camera angle, framing, zoom level and crop of the input image. Do not pan, do not zoom, do not change orientation. The project's silhouette in the output must overlay 1:1 with the silhouette in the input.");
    return lines.join("\n");
  }, [groundCount, groundHeightM, podiumCount, podiumHeightM, towerCount, towerHeightM, basementCount, totalH, towerArea]);

  const handleAiRender = useCallback(async () => {
    if (!apiKey) {
      setKeyDialog({ open: true, draft: "" });
      return;
    }
    const png = captureRef.current?.();
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
                facade={facadeParams}
              />
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

            <FacadePanel params={facadeParams} onPatch={patchFacade} />

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

            <div className="border border-ink-200">
              <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 flex items-center justify-between gap-2">
                <span className="eyebrow text-ink-500 text-[10px]">AI render</span>
                <div className="inline-flex border border-ink-200 bg-white">
                  {([["scheme", "Schematic"], ["hyperreal", "Hyperreal"]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setAiStyle(id)}
                      className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
                        aiStyle === id ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-100"
                      }`}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div className="p-3 grid gap-2">
                <button
                  className="px-2.5 py-2 text-[10.5px] font-medium uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50 disabled:cursor-wait transition-colors"
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

interface FacadePanelParams {
  mode: "massing" | "residential";
  panelWidthM: number;
  balconyDepthM: number;
  balconyEveryNBays: number;
  solidPanelRatio: number;
  balconyLayout: "rhythm" | "random";
  patternSeed: number;
}

function FacadePanel({
  params, onPatch,
}: {
  params: FacadePanelParams;
  onPatch: (p: Partial<FacadePanelParams>) => void;
}) {
  const residential = params.mode === "residential";
  return (
    <div className="border border-ink-200">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 flex items-center justify-between gap-2">
        <span className="eyebrow text-ink-500 text-[10px]">Facade</span>
        <div className="inline-flex border border-ink-200 bg-white">
          <button
            onClick={() => onPatch({ mode: "massing" })}
            className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
              !residential ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-100"
            }`}
          >Massing</button>
          <button
            onClick={() => onPatch({ mode: "residential" })}
            className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
              residential ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-100"
            }`}
            title="Model the tower facade: floor slabs, glazing, mullions and balconies"
          >Residential</button>
        </div>
      </div>
      {residential && (
        <div className="p-3 grid gap-2">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Bay width m">
              <input
                type="number"
                step={0.2}
                min={1}
                className="cell-input text-right"
                value={Number(params.panelWidthM.toFixed(1))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 1) onPatch({ panelWidthM: n });
                }}
                title="Vertical mullion spacing along the facade"
              />
            </Field>
            <Field label="Balcony m">
              <input
                type="number"
                step={0.2}
                min={0}
                className="cell-input text-right"
                value={Number(params.balconyDepthM.toFixed(1))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) onPatch({ balconyDepthM: n });
                }}
                title="Balcony depth — 0 removes balconies"
              />
            </Field>
            <Field label="Every N bays">
              <input
                type="number"
                step={1}
                min={1}
                className="cell-input text-right"
                value={params.balconyEveryNBays}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n) && n >= 1) onPatch({ balconyEveryNBays: n });
                }}
                title="A balcony on every Nth facade bay (or 1/N probability in random layout)"
              />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Field label="Solid panels %">
              <input
                type="number"
                step={5}
                min={0}
                max={100}
                className="cell-input text-right"
                value={Math.round(params.solidPanelRatio * 100)}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0 && n <= 100) onPatch({ solidPanelRatio: n / 100 });
                }}
                title="Share of facade cells filled with a solid precast panel instead of glazing"
              />
            </Field>
            <Field label="Balcony layout">
              <div className="inline-flex border border-ink-200 bg-white">
                {([["rhythm", "Rhythm"], ["random", "Random"]] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => onPatch({ balconyLayout: id })}
                    className={`px-2.5 py-[7px] text-[10px] font-medium uppercase tracking-[0.10em] transition-colors ${
                      params.balconyLayout === id ? "bg-ink-900 text-bone-100" : "text-ink-700 hover:bg-bone-100"
                    }`}
                    title={id === "rhythm" ? "Balconies stack in regular columns" : "Balconies scattered randomly across the facade"}
                  >{label}</button>
                ))}
              </div>
            </Field>
          </div>
          <button
            className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] border border-ink-300 bg-white text-ink-800 hover:bg-bone-50 transition-colors"
            onClick={() => onPatch({ patternSeed: Math.floor(Math.random() * 100000) + 1 })}
            title="Re-roll the random pattern of solid panels and scattered balconies"
          >⤲ Shuffle pattern</button>
          <p className="text-[10.5px] text-ink-500 leading-snug">
            Applies to the tower: floor slabs, recessed glazing, mullions on the bay rhythm,
            solid panels scattered at the given share, and balconies. Ground and podium keep
            the massing look.
          </p>
        </div>
      )}
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
