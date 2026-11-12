"use client";
import { useMemo, useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import type { ParcelInfo } from "@/lib/types";
import { processParcel, type PdfTextItem } from "@/lib/parcel-extract";
import {
  pickReferenceEdge,
  polygonPxToMetres,
  tryAutoCalibrate,
  type AutoCalibrationResult,
} from "@/lib/plot-auto-calibrate";
import { polygonArea, polygonCentroid, type Point } from "@/lib/geom";
import { fmt2 } from "@/lib/format";
import PlanTrace, { type TraceMode } from "./plan-trace";
import { resolveTiers, tierOrigin, wouldLoop, type TierKey, type TierMode } from "@/lib/tier-geometry";
import { distributionFootprints, footprintsPatch, plotFootprints, tierFloors, unmodelledTiers } from "@/lib/tier-status";

type Phase = "idle" | "rendering" | "done" | "error";

type TraceTarget = "plot" | "ground" | "podium" | "tower";
const TIER_TARGETS = ["ground", "podium", "tower"] as const;
const TIER_LABELS: Record<(typeof TIER_TARGETS)[number], string> = {
  ground: "Ground",
  podium: "Podium",
  tower: "Tower",
};
const TIER_COLORS: Record<(typeof TIER_TARGETS)[number], string> = {
  ground: "#8a9a76",
  podium: "#a17e4c",
  tower: "#3f5135",
};
const TIER_POLY_FIELD = {
  ground: "groundPolygon",
  podium: "podiumPolygon",
  tower: "towerPolygon",
} as const;

export default function PlotTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const parcel = project.parcel;

  const [phase, setPhase] = useState<Phase>(parcel ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trace state
  const [traceMode, setTraceMode] = useState<TraceMode>("idle");
  const [traceTarget, setTraceTarget] = useState<TraceTarget>("plot");
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [calibInput, setCalibInput] = useState<string>("");

  // Vector candidates + text runs detected from PDF on upload (not persisted)
  const [candidates, setCandidates] = useState<Point[][]>([]);
  const [textItems, setTextItems] = useState<PdfTextItem[]>([]);

  // Auto-calibration attempt against the currently traced/selected polygon.
  // Requires visual confirmation before it's applied — see StepBlock 2 below.
  const [autoCalib, setAutoCalib] = useState<AutoCalibrationResult | null>(null);
  const [autoCalibTried, setAutoCalibTried] = useState(false);

  // Whether the current traced polygon was picked automatically by the
  // yellow-fill/red-stroke parcel detector (drives the little note in Step 1).
  const [autoPicked, setAutoPicked] = useState(false);
  // Whether the scale was applied automatically from the PDF cotas (Step 2 note).
  const [autoApplied, setAutoApplied] = useState(false);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhase("rendering");
      const result = await processParcel(file);
      const autoPoly =
        result.autoParcelIndex !== null ? result.candidatePolygons[result.autoParcelIndex] : null;
      // If the previous image was dropped to free localStorage quota but the
      // trace/calibration survived, and the re-uploaded file renders at the
      // same pixel size (same drawing), keep the existing geometry intact.
      const preserve =
        !!parcel &&
        !parcel.imageDataUrl &&
        !!parcel.tracePolygonPx &&
        parcel.imageNaturalWidth === result.imageNaturalWidth &&
        parcel.imageNaturalHeight === result.imageNaturalHeight;
      const next: ParcelInfo = {
        fileName: file.name,
        fileType: file.type || "image/jpeg",
        imageDataUrl: result.imageDataUrl,
        uploadedAt: Date.now(),
        imageNaturalWidth: result.imageNaturalWidth,
        imageNaturalHeight: result.imageNaturalHeight,
        // The DLD parcel highlight was recognised — trace it without asking.
        tracePolygonPx: preserve ? parcel.tracePolygonPx : autoPoly ?? undefined,
        calibration: preserve ? parcel.calibration : undefined,
        tierTracesPx: preserve ? parcel.tierTracesPx : undefined,
      };
      patch({ parcel: next });
      setCandidates(result.candidatePolygons);
      setTextItems(result.textItems);
      setAutoCalib(null);
      setAutoCalibTried(false);
      setAutoPicked(!!autoPoly && !preserve);
      if (preserve) {
        setTraceMode("idle");
      } else if (autoPoly) {
        // Polygon locked in — run scale detection immediately; when the cota
        // consensus is strong this applies polygon + area with no clicks at
        // all. Pass the text items explicitly: the setTextItems above hasn't
        // committed yet.
        setTraceMode("idle");
        runAutoCalibration(autoPoly, next, result.textItems);
      } else if (result.candidatePolygons.length > 0) {
        // Fall back to manual pick among the ranked candidates.
        setTraceMode("selecting");
      }
      setPhase("done");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Could not process this file");
      setPhase("error");
    }
  }

  function clearParcel() {
    if (!confirm("Remove the uploaded plot drawing?")) return;
    patch({ parcel: undefined });
    setPhase("idle");
    setTraceMode("idle");
    setLivePoints([]);
    setCandidates([]);
    setTextItems([]);
    setAutoCalib(null);
    setAutoCalibTried(false);
    setAutoPicked(false);
    setAutoApplied(false);
  }

  /** Read the plot's scale straight from the dimension labels printed on the
   *  PDF and — when the consensus is strong (≥3 agreeing cotas) — apply it
   *  immediately: polygon + area land in the project with zero extra clicks.
   *  Weaker detections surface as a review panel in Step 2 instead; no
   *  detection at all falls back to manual 2-point calibration.
   *  Returns true when the scale was applied automatically. */
  function runAutoCalibration(poly: Point[], parcelObj: ParcelInfo, items: PdfTextItem[] = textItems): boolean {
    const result = tryAutoCalibrate(poly, items);
    setAutoCalib(result);
    setAutoCalibTried(true);
    if (result?.confident) {
      const ref = pickReferenceEdge(result, poly);
      const { plotPolygon, areaM2 } = polygonPxToMetres(poly, result.scale);
      // Prefer the plan's declared area verbatim when the scale was anchored
      // to it — the polygon then agrees with the official figure exactly.
      const area = result.anchoredAreaM2 ?? Math.round(areaM2 * 100) / 100;
      patch({
        parcel: { ...parcelObj, tracePolygonPx: poly, calibration: ref },
        plotMode: "polygon",
        plotPolygon,
        plotArea: project.plotArea > 0 ? project.plotArea : area,
      });
      setAutoApplied(true);
      return true;
    }
    setAutoApplied(false);
    return false;
  }

  function selectCandidate(idx: number) {
    if (!parcel) return;
    const poly = candidates[idx];
    if (!poly || poly.length < 3) return;
    const nextParcel: ParcelInfo = { ...parcel, tracePolygonPx: poly, calibration: undefined };
    patch({ parcel: nextParcel });
    setTraceMode("idle");
    setCandidates([]);
    setAutoPicked(false);
    runAutoCalibration(poly, nextParcel);
  }

  /* ---------- Trace flow ---------- */
  function startTrace() {
    setTraceTarget("plot");
    setTraceMode("tracing");
    setLivePoints([]);
    setAutoCalib(null);
    setAutoCalibTried(false);
    setAutoPicked(false);
    setAutoApplied(false);
  }
  function cancelTrace() {
    setTraceMode("idle");
    setTraceTarget("plot");
    setLivePoints([]);
  }

  /** Similarity transform (uniform scale + Y flip + translation) that maps the
   *  traced plot outline (px) onto the persisted plot polygon (plot-local
   *  metres). Applying it to a tier trace lands the tier footprint in exactly
   *  the same frame Massing works in — including area-anchored calibrations,
   *  which only differ by a uniform scale. */
  function pxLocalTransform(): { s: number; tx: number; ty: number } | null {
    const tracePx = parcel?.tracePolygonPx;
    const plotLocal = project.plotPolygon;
    if (!tracePx || !plotLocal || tracePx.length < 2 || tracePx.length !== plotLocal.length) return null;
    let ai = 0, bi = 1, best = -1;
    for (let i = 0; i < tracePx.length; i++) {
      for (let j = i + 1; j < tracePx.length; j++) {
        const d = Math.hypot(tracePx[i].x - tracePx[j].x, tracePx[i].y - tracePx[j].y);
        if (d > best) { best = d; ai = i; bi = j; }
      }
    }
    const dLocal = Math.hypot(plotLocal[ai].x - plotLocal[bi].x, plotLocal[ai].y - plotLocal[bi].y);
    if (best < 1e-6 || dLocal <= 0) return null;
    const s = dLocal / best;
    let tx = 0, ty = 0;
    for (let i = 0; i < tracePx.length; i++) {
      tx += plotLocal[i].x - s * tracePx[i].x;
      ty += plotLocal[i].y + s * tracePx[i].y;
    }
    return { s, tx: tx / tracePx.length, ty: ty / tracePx.length };
  }
  function tierPxToLocal(px: Point[]): Point[] | null {
    const t = pxLocalTransform();
    return t ? px.map((p) => ({ x: t.s * p.x + t.tx, y: -t.s * p.y + t.ty })) : null;
  }
  /** Plot-local metres → drawing pixels, to draw a footprint over the plan. */
  function tierLocalToPx(local: Point[]): Point[] | null {
    const t = pxLocalTransform();
    return t ? local.map((p) => ({ x: (p.x - t.tx) / t.s, y: (t.ty - p.y) / t.s })) : null;
  }

  /* ---------------- Tier footprints — every tier is a LIST ----------------
   * Each tier (ground / podium / tower) can hold any number of blocks. The
   * legacy singular fields count as block #1 until the first plural write
   * migrates them, so existing projects keep working untouched. */
  const TIER_PLURAL_FIELD = {
    ground: "groundPolygons",
    podium: "podiumPolygons",
    tower: "towerPolygons",
  } as const;
  const TIER_TRACE_KEY = { ground: "grounds", podium: "podiums", tower: "towers" } as const;

  const tierPolys = useMemo(() => {
    const pick = (
      plural: { x: number; y: number }[][] | undefined,
      single: { x: number; y: number }[] | undefined,
    ) => plural ?? (single && single.length >= 3 ? [single] : []);
    return {
      ground: pick(project.groundPolygons, project.groundPolygon),
      podium: pick(project.podiumPolygons, project.podiumPolygon),
      tower: pick(project.towerPolygons, project.towerPolygon),
    };
  }, [
    project.groundPolygons, project.groundPolygon,
    project.podiumPolygons, project.podiumPolygon,
    project.towerPolygons, project.towerPolygon,
  ]);

  const tierTracesPx = useMemo(() => {
    const t = parcel?.tierTracesPx;
    const pick = (
      plural: { x: number; y: number }[][] | undefined,
      single: { x: number; y: number }[] | undefined,
    ) => plural ?? (single && single.length >= 3 ? [single] : []);
    return {
      ground: pick(t?.grounds, t?.ground),
      podium: pick(t?.podiums, t?.podium),
      tower: pick(t?.towers, t?.tower),
    };
  }, [parcel?.tierTracesPx]);

  /** Write a tier's whole block list (polygons + pixel traces) at once. */
  function writeTier(
    tier: (typeof TIER_TARGETS)[number],
    polys: Point[][],
    traces: Point[][],
    setMode?: TierMode,
  ) {
    patch({
      ...(setMode ? { tierMode: { ...project.tierMode, [tier]: setMode } } : {}),
      [TIER_PLURAL_FIELD[tier]]: polys.length > 0 ? polys : undefined,
      // Retire the legacy singular field the moment we touch this tier.
      [TIER_POLY_FIELD[tier]]: undefined,
      parcel: parcel
        ? {
            ...parcel,
            tierTracesPx: {
              ...parcel.tierTracesPx,
              [TIER_TRACE_KEY[tier]]: traces.length > 0 ? traces : undefined,
              [tier]: undefined,
            },
          }
        : parcel,
    });
  }

  function startTierTrace(tier: (typeof TIER_TARGETS)[number]) {
    setTraceTarget(tier);
    setTraceMode("tracing");
    setLivePoints([]);
  }

  function commitTierTrace(tier: (typeof TIER_TARGETS)[number], px: Point[]) {
    const local = tierPxToLocal(px);
    if (!local) {
      alert(
        "The plot polygon no longer matches the traced outline (it was edited in Massing, or the plot isn't calibrated). Re-trace and calibrate the plot first.",
      );
      return;
    }
    if (!parcel) return;
    // Every tier accumulates: a new trace ADDS a block.
    // A freshly traced block also switches the tier to "traced".
    writeTier(tier, [...tierPolys[tier], local], [...tierTracesPx[tier], px], "traced");
  }

  function removeTierBlock(tier: (typeof TIER_TARGETS)[number], index: number) {
    writeTier(
      tier,
      tierPolys[tier].filter((_, i) => i !== index),
      tierTracesPx[tier].filter((_, i) => i !== index),
    );
  }

  /* ---------------- How each tier gets its footprint ----------------
   * Setbacks, traced blocks, or the same geometry as another tier (live).
   * The resolver in lib/tier-geometry is the same one Massing uses. */
  const resolvedTiers = useMemo(() => resolveTiers(project), [project]);

  // Floors per tier (Setup / Distribution) — a tier with none is not modelled.
  const floors = useMemo(() => tierFloors(project), [project]);
  const tierIssues = useMemo(() => unmodelledTiers(project), [project]);
  const plotFp = useMemo(() => plotFootprints(project), [project]);
  const distFp = distributionFootprints(project);
  const footprintsDiffer = TIER_TARGETS.some((t) => Math.abs(plotFp[t] - distFp[t]) > 1);
  function setTierLevels(tier: "ground" | "podium", n: number) {
    const count = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    if (tier === "ground") patch({ ground: { count, heightM: project.ground?.heightM ?? 4.5 } });
    else patch({ podium: { count, heightM: project.podium?.heightM ?? 4.0 } });
  }

  function setTierMode(tier: TierKey, mode: TierMode) {
    patch({ tierMode: { ...project.tierMode, [tier]: mode } });
  }
  /** What the selector highlights: the tier it follows, else setbacks / traced. */
  function selectedMode(tier: TierKey): TierMode {
    const stored = project.tierMode?.[tier];
    if ((stored === "ground" || stored === "podium" || stored === "tower") && tierOrigin(project, tier) !== tier) return stored;
    if (stored === "traced") return "traced";
    return resolvedTiers[tier].source;
  }
  function setUniformSetback(tier: TierKey, v: number) {
    const safe = Number.isFinite(v) && v >= 0 ? v : 0;
    if (tier === "ground") patch({ groundSetbackM: safe, groundSetbackPerEdge: undefined });
    else if (tier === "podium") patch({ podiumSetbackM: safe, podiumSetbackPerEdge: undefined });
    else patch({ towerSetbackM: safe, towerSetbackPerEdge: undefined });
  }

  /** Effective footprints drawn over the plan. Tiers that share the exact
   *  same outline get one shape with a joint label ("Ground + Podium"). */
  const tierOverlays = (() => {
    const groups = new Map<string, { tiers: TierKey[]; polys: Point[][] }>();
    for (const t of TIER_TARGETS) {
      const polys = resolvedTiers[t].polygons.filter((poly) => poly.length >= 3);
      if (polys.length === 0) continue;
      const key = JSON.stringify(polys.map((poly) => poly.map((q) => [Math.round(q.x * 100), Math.round(q.y * 100)])));
      const g = groups.get(key);
      if (g) g.tiers.push(t);
      else groups.set(key, { tiers: [t], polys });
    }
    const out: { points: Point[]; color: string; label: string; labelDy: number }[] = [];
    let gi = 0;
    for (const g of groups.values()) {
      const name = g.tiers.map((t) => TIER_LABELS[t]).join(" + ");
      // Nested footprints share a centroid: stack their labels 18 px apart.
      const labelDy = (gi - (groups.size - 1) / 2) * 18;
      g.polys.forEach((poly, i) => {
        const px = tierLocalToPx(poly);
        if (px) out.push({ points: px, color: TIER_COLORS[g.tiers[g.tiers.length - 1]], label: g.polys.length > 1 ? `${name} ${i + 1}` : name, labelDy });
      });
      gi++;
    }
    return out;
  })();

  function finishTrace() {
    if (livePoints.length < 3) {
      alert("Click at least 3 corners to define a polygon.");
      return;
    }
    if (!parcel) return;
    if (traceTarget !== "plot") {
      commitTierTrace(traceTarget, livePoints);
      setTraceMode("idle");
      setTraceTarget("plot");
      setLivePoints([]);
      return;
    }
    const nextParcel: ParcelInfo = { ...parcel, tracePolygonPx: livePoints, calibration: undefined };
    patch({ parcel: nextParcel });
    setTraceMode("idle");
    runAutoCalibration(livePoints, nextParcel);
    setLivePoints([]);
  }
  function onTraceClick(p: { x: number; y: number }, meta?: { screenPxPerImagePx: number }) {
    if (traceMode !== "tracing") return;
    // Click ON the first point's marker closes the polygon. The threshold is
    // ~the marker radius in SCREEN pixels — constant to the eye at any zoom.
    // (It used to be 2% of the image width in IMAGE pixels, which at 4× zoom
    // swallowed clicks tens of screen-px away from the start point, so small
    // footprints — the reason to zoom in — closed after their third vertex.)
    if (livePoints.length >= 3) {
      const a = livePoints[0];
      const dist = Math.hypot(p.x - a.x, p.y - a.y);
      const threshold =
        meta && meta.screenPxPerImagePx > 0
          ? 14 / meta.screenPxPerImagePx
          : (parcel?.imageNaturalWidth ?? 1000) * 0.02;
      if (dist < threshold) {
        // Close
        const final = livePoints;
        if (traceTarget !== "plot") {
          commitTierTrace(traceTarget, final);
        } else if (parcel) {
          const nextParcel: ParcelInfo = { ...parcel, tracePolygonPx: final, calibration: undefined };
          patch({ parcel: nextParcel });
          runAutoCalibration(final, nextParcel);
        }
        setTraceMode("idle");
        setTraceTarget("plot");
        setLivePoints([]);
        return;
      }
    }
    setLivePoints([...livePoints, p]);
  }

  /* ---------- Calibrate flow ---------- */
  function startCalibrate() {
    setTraceMode("calibrating");
    setLivePoints([]);
    setCalibInput("");
  }
  function cancelCalibrate() {
    setTraceMode("idle");
    setLivePoints([]);
  }
  function onCalibClick(p: { x: number; y: number }) {
    if (traceMode !== "calibrating") return;
    const next = livePoints.length < 2 ? [...livePoints, p] : [livePoints[1], p];
    setLivePoints(next);
  }
  /** Shared core: convert the traced polygon (px) to metres given a
   *  metres-per-pixel scale, recentre on its centroid (flipping Y so the
   *  visual top becomes +y), and persist plot polygon + area + a calibration
   *  record (used for the "Calibrated · X m ref" badge elsewhere). */
  function commitScale(scale: number, calibration: { p1: Point; p2: Point; metres: number }) {
    if (!parcel || !parcel.tracePolygonPx) return;
    const inMetres = parcel.tracePolygonPx.map((p) => ({
      x: p.x * scale,
      y: -p.y * scale,
    }));
    const c = polygonCentroid(inMetres);
    const recentred = inMetres.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    const area = polygonArea(recentred);
    patch({
      parcel: { ...parcel, calibration },
      plotMode: "polygon",
      plotPolygon: recentred,
      plotArea: project.plotArea > 0 ? project.plotArea : Math.round(area * 100) / 100,
    });
  }

  function applyCalibration() {
    if (!parcel || !parcel.tracePolygonPx) return;
    if (livePoints.length < 2) {
      alert("Click two reference points on the drawing.");
      return;
    }
    const metres = parseFloat(calibInput);
    if (!Number.isFinite(metres) || metres <= 0) {
      alert("Enter the real-world distance in metres for the two points.");
      return;
    }
    const [p1, p2] = livePoints;
    const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (distPx < 1) {
      alert("Calibration points are too close together.");
      return;
    }
    commitScale(metres / distPx, { p1, p2, metres });
    setTraceMode("idle");
    setLivePoints([]);
    setCalibInput("");
    setAutoCalib(null);
    setAutoApplied(false);
  }

  /** Apply the auto-detected scale. Uses the matched edge whose implied scale
   *  is closest to the overall median as the illustrative p1/p2 reference —
   *  its metres value is derived from the applied scale (not the raw label)
   *  so the "Calibrated · X m ref" badge stays exactly self-consistent. */
  function applyAutoCalibration() {
    if (!parcel || !parcel.tracePolygonPx || !autoCalib) return;
    const best = [...autoCalib.matches].sort(
      (a, b) => Math.abs(a.impliedScale - autoCalib.scale) - Math.abs(b.impliedScale - autoCalib.scale)
    )[0];
    const p1 = parcel.tracePolygonPx[best.edgeIndex];
    const p2 = parcel.tracePolygonPx[(best.edgeIndex + 1) % parcel.tracePolygonPx.length];
    const metres = autoCalib.scale * best.pixelLength;
    commitScale(autoCalib.scale, { p1, p2, metres });
    setAutoCalib(null);
  }

  function dismissAutoCalibration() {
    setAutoCalib(null);
    startCalibrate();
  }

  function clearTrace() {
    if (!parcel) return;
    if (!confirm("Clear traced polygon and calibration?")) return;
    patch({ parcel: { ...parcel, tracePolygonPx: undefined, calibration: undefined } });
    setAutoCalib(null);
    setAutoCalibTried(false);
    setAutoApplied(false);
  }

  /* ---------- derived ---------- */
  const hasTrace = !!parcel?.tracePolygonPx && parcel.tracePolygonPx.length >= 3;
  const isCalibrated = hasTrace && !!parcel?.calibration;
  const livePolygonArea = (() => {
    if (!parcel?.tracePolygonPx || !parcel.calibration) return 0;
    const scale = parcel.calibration.metres /
      Math.hypot(
        parcel.calibration.p2.x - parcel.calibration.p1.x,
        parcel.calibration.p2.y - parcel.calibration.p1.y
      );
    const m = parcel.tracePolygonPx.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    return polygonArea(m);
  })();

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Plot drawing</h2>
          <p className="section-sub">
            Upload the affection plan or plot drawing, then trace the parcel boundary by clicking each corner and
            calibrate the scale by clicking two known points and entering the cota.
          </p>
        </div>

        {!parcel && phase === "idle" && (
          <Dropzone onFiles={handleFiles} inputRef={inputRef} />
        )}

        {parcel && !parcel.imageDataUrl && (phase === "done" || phase === "idle") && (
          <div className="grid gap-4">
            <div className="border border-amber-300 bg-amber-50 text-amber-900 p-4 text-sm">
              <div className="font-medium mb-1">Plan image removed to free browser storage</div>
              <div className="text-amber-800/90">
                Your browser&apos;s local storage filled up, so the plan drawing image
                (<span className="font-medium">{parcel.fileName}</span>) was dropped to keep the project
                data safe. All traced geometry, calibration and areas are intact — re-upload the same
                drawing below to see it again.
              </div>
            </div>
            <Dropzone onFiles={handleFiles} inputRef={inputRef} />
          </div>
        )}

        {phase === "rendering" && (
          <div className="border border-ink-200 bg-bone-50 p-8 text-center">
            <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-sm font-medium text-ink-900">Loading the plot…</div>
          </div>
        )}

        {phase === "error" && (
          <div className="border border-red-200 bg-red-50 text-red-800 p-4 text-sm">
            <div className="font-medium mb-1">Could not process the file</div>
            <div className="text-red-700/80">{error}</div>
            <button className="btn btn-secondary mt-3" onClick={() => setPhase("idle")}>Try another file</button>
          </div>
        )}

        {parcel && !!parcel.imageDataUrl && (phase === "done" || phase === "idle") && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
            {/* Image with overlay */}
            <div>
              <div className="border border-ink-200 bg-bone-50 overflow-hidden">
                <PlanTrace
                  parcel={parcel}
                  mode={traceMode}
                  tracePolygonPx={
                    traceMode === "idle" || traceMode === "calibrating" || traceTarget !== "plot"
                      ? parcel.tracePolygonPx
                      : undefined
                  }
                  calibration={traceMode === "idle" ? parcel.calibration : undefined}
                  livePoints={traceMode === "tracing" || traceMode === "calibrating" ? livePoints : undefined}
                  hoverPoint={hoverPoint}
                  candidates={traceMode === "selecting" ? candidates : undefined}
                  onSelectCandidate={selectCandidate}
                  extraPolygons={isCalibrated ? tierOverlays : []}
                  onPick={(p, meta) => {
                    if (traceMode === "tracing") onTraceClick(p, meta);
                    else if (traceMode === "calibrating") onCalibClick(p);
                  }}
                  onHover={setHoverPoint}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-500 flex-wrap">
                <div className="truncate">
                  <span className="font-medium text-ink-700">{parcel.fileName}</span>
                  <span className="mx-2">·</span>
                  <span>uploaded {new Date(parcel.uploadedAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn btn-secondary btn-xs" onClick={() => inputRef.current?.click()}>Replace</button>
                  <button className="btn btn-danger btn-xs" onClick={clearParcel}>Remove</button>
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {/* Side panel: trace controls */}
            <div className="grid gap-4 content-start">
              <StepBlock
                step="1"
                title="Capture the parcel"
                done={hasTrace}
                description={
                  candidates.length > 0
                    ? "Click on the polygon that represents the parcel — geometry is read straight from the vector PDF."
                    : "Click each corner of the plot. Click the first vertex (or press Done) to close."
                }
              >
                {traceMode === "selecting" ? (
                  <div className="grid gap-2">
                    <div className="text-[11px] text-ink-700">
                      {candidates.length} candidate polygon{candidates.length === 1 ? "" : "s"} detected · click one
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-xs" onClick={() => { setTraceMode("idle"); setCandidates([]); }}>
                        Trace manually instead
                      </button>
                    </div>
                  </div>
                ) : traceMode === "tracing" ? (
                  <div className="grid gap-2">
                    <div className="text-[11px] text-ink-700">{livePoints.length} point{livePoints.length === 1 ? "" : "s"} so far</div>
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-xs" onClick={finishTrace}>Done</button>
                      <button className="btn btn-secondary btn-xs" onClick={cancelTrace}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {candidates.length > 0 && (
                      <button className="btn btn-primary btn-xs" onClick={() => setTraceMode("selecting")}>
                        Pick from PDF ({candidates.length})
                      </button>
                    )}
                    <button className={`btn btn-xs ${candidates.length > 0 ? "btn-secondary" : "btn-primary"}`} onClick={startTrace}>
                      {hasTrace ? "Re-trace" : "Trace manually"}
                    </button>
                    {hasTrace && (
                      <button className="btn btn-secondary btn-xs" onClick={clearTrace}>Clear</button>
                    )}
                  </div>
                )}
                {hasTrace && (
                  <div className="mt-2 text-[11px] text-ink-500">
                    {autoPicked && (
                      <span className="text-qube-700 font-medium">
                        ✓ Parcel auto-detected (yellow fill / red boundary) ·{" "}
                      </span>
                    )}
                    {parcel.tracePolygonPx!.length} vertices captured{isCalibrated ? "" : " · awaiting calibration"}
                  </div>
                )}
              </StepBlock>

              <StepBlock
                step="2"
                title="Calibrate scale"
                done={isCalibrated}
                disabled={!hasTrace}
                description={
                  isCalibrated && autoApplied
                    ? "Scale read automatically from the dimension labels printed on the PDF."
                    : autoCalib && !autoCalib.confident && !isCalibrated
                    ? "A possible scale was detected from the PDF cotas but the match is weak — review it or calibrate manually."
                    : "Click two points on the drawing whose distance you can read from the cotas, then enter that distance in metres."
                }
              >
                {!hasTrace ? (
                  <div className="text-[11px] text-ink-400">Trace the polygon first</div>
                ) : autoCalib && !autoCalib.confident && autoCalib.matches.length >= 2 && !isCalibrated && traceMode !== "calibrating" ? (
                  <div className="grid gap-2">
                    <div className="border border-amber-200 bg-amber-50 p-2">
                      <div className="text-[10.5px] uppercase tracking-[0.10em] text-amber-900 font-medium mb-1">
                        {autoCalib.matches.length} of {autoCalib.totalEdges} edges matched
                        {autoCalib.deviationPct > 0 && ` · deviation ${autoCalib.deviationPct.toFixed(1)}%`}
                        {" · needs review"}
                      </div>
                      <div className="grid gap-0.5">
                        {autoCalib.matches.map((m) => (
                          <div key={m.edgeIndex} className="flex items-center justify-between text-[11px] text-ink-700 tabular-nums">
                            <span>Edge {m.edgeIndex + 1} · &quot;{m.labelText}&quot;</span>
                            <span>{m.labelMetres.toFixed(2)} m</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-[10.5px] text-ink-500 mt-1">
                        Scale: 1 px ≈ {autoCalib.scale.toFixed(4)} m
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-xs" onClick={applyAutoCalibration}>
                        Apply detected scale
                      </button>
                      <button className="btn btn-secondary btn-xs" onClick={dismissAutoCalibration}>
                        Calibrate manually instead
                      </button>
                    </div>
                  </div>
                ) : traceMode === "calibrating" ? (
                  <div className="grid gap-2">
                    <div className="text-[11px] text-ink-700">
                      {livePoints.length === 0 && "Click the first reference point"}
                      {livePoints.length === 1 && "Click the second reference point"}
                      {livePoints.length === 2 && "Now enter the real-world distance"}
                    </div>
                    {livePoints.length === 2 && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          autoFocus
                          placeholder="metres"
                          className="cell-input text-right flex-1"
                          value={calibInput}
                          onChange={(e) => setCalibInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") applyCalibration(); }}
                        />
                        <span className="text-[11px] text-ink-500">m</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-xs" onClick={applyCalibration} disabled={livePoints.length < 2 || !calibInput}>
                        Apply
                      </button>
                      <button className="btn btn-secondary btn-xs" onClick={cancelCalibrate}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-xs" onClick={startCalibrate}>
                      {isCalibrated ? "Re-calibrate" : "Calibrate"}
                    </button>
                  </div>
                )}
                {!isCalibrated && traceMode !== "calibrating" && autoCalibTried && !autoCalib && (
                  <div className="mt-2 text-[11px] text-ink-500">
                    No readable dimension labels found on the PDF — calibrate manually.
                  </div>
                )}
                {isCalibrated && parcel.calibration && (
                  <div className="mt-2 text-[11px] text-ink-500">
                    {autoApplied && autoCalib ? (
                      <span className="text-qube-700 font-medium">
                        ✓ Auto-calibrated from {autoCalib.matches.length} cotas · deviation{" "}
                        {autoCalib.deviationPct.toFixed(1)}%
                        {autoCalib.anchoredAreaM2 !== null &&
                          ` · area anchored to the plan's declared ${autoCalib.anchoredAreaM2.toLocaleString("en-US")} m²`}
                      </span>
                    ) : (
                      <>Reference: {parcel.calibration.metres.toFixed(2)} m between picked points</>
                    )}
                  </div>
                )}
              </StepBlock>

              {isCalibrated && (
                <div className="border border-emerald-200 bg-emerald-50 text-emerald-900 p-3 text-xs">
                  <div className="font-semibold uppercase tracking-[0.10em] text-[10.5px]">Polygon ready</div>
                  <div className="mt-1">Plot area: <strong>{fmt2(livePolygonArea)} m²</strong></div>
                  <div className="text-emerald-800/80 mt-0.5">
                    Saved to Massing tab in polygon mode.
                  </div>
                </div>
              )}

              {isCalibrated && (
                <StepBlock
                  step="3"
                  title="Building footprints (optional)"
                  done={TIER_TARGETS.some((t) => resolvedTiers[t].mode !== "setbacks")}
                  description="How each tier gets its footprint: Setbacks (the plot line moved inward), Traced (draw it on the plan) or the same as another tier. All three are drawn on the plan and used by Massing."
                >
                  <div className="grid gap-3">
                    {TIER_TARGETS.map((tier) => {
                      const blocks = tierPolys[tier];
                      const r = resolvedTiers[tier];
                      const sel = selectedMode(tier);
                      const tracingThis = traceMode === "tracing" && traceTarget === tier;
                      const area = r.polygons.reduce((sum, poly) => sum + polygonArea(poly), 0);
                      const perEdge = r.setbacks;
                      const mixed = perEdge.some((v) => Math.abs(v - perEdge[0]) > 1e-9);
                      const others = TIER_TARGETS.filter((t) => t !== tier);
                      const issue = tierIssues.find((i) => i.tier === tier);
                      return (
                        <div key={tier} className="border border-ink-200 bg-white">
                          <div className="flex items-center gap-2 px-2.5 pt-2 text-[12px]">
                            <span className="inline-block w-3 h-3 shrink-0" style={{ backgroundColor: TIER_COLORS[tier] }} />
                            <span className="font-medium text-ink-900">{TIER_LABELS[tier]}</span>
                            <span className="ml-auto text-ink-500 tabular-nums text-[11.5px]">{fmt2(area)} m²</span>
                          </div>
                          <div className="px-2.5 pt-1.5">
                            <div className="seg w-full grid grid-cols-4" role="radiogroup" aria-label={`${TIER_LABELS[tier]} footprint`}>
                              <button
                                className="seg-btn !px-1" role="radio" aria-checked={sel === "setbacks"} data-active={sel === "setbacks"}
                                disabled={traceMode !== "idle"} onClick={() => setTierMode(tier, "setbacks")}
                                title="The plot line moved inward by this tier's setback"
                              >Setbacks</button>
                              <button
                                className="seg-btn !px-1" role="radio" aria-checked={sel === "traced"} data-active={sel === "traced"}
                                disabled={traceMode !== "idle"} onClick={() => setTierMode(tier, "traced")}
                                title="Draw this tier's footprint on the plan"
                              >Traced</button>
                              {others.map((o) => {
                                const loop = wouldLoop(project, tier, o);
                                return (
                                  <button
                                    key={o}
                                    className="seg-btn !px-1" role="radio" aria-checked={sel === o} data-active={sel === o}
                                    disabled={traceMode !== "idle" || loop}
                                    onClick={() => setTierMode(tier, o)}
                                    title={
                                      loop
                                        ? `The ${TIER_LABELS[o].toLowerCase()} already follows the ${TIER_LABELS[tier].toLowerCase()}`
                                        : `Same geometry as the ${TIER_LABELS[o].toLowerCase()} — follows it when it changes`
                                    }
                                  >= {TIER_LABELS[o]}</button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="px-2.5 py-2 grid gap-1 text-[11.5px]">
                            {sel === "setbacks" && (
                              <label className="flex items-center gap-2">
                                <span className="text-ink-600">Setback from the plot line</span>
                                <span className="relative ml-auto">
                                  <input
                                    type="number" min={0} step={0.5}
                                    className="cell-input text-right !py-1 !pl-1 !pr-6 !w-[84px]"
                                    value={mixed ? "" : Number(perEdge[0]?.toFixed(2) ?? 0)}
                                    placeholder={mixed ? "per edge" : "0"}
                                    onChange={(e) => {
                                      const n = parseFloat(e.target.value);
                                      if (Number.isFinite(n)) setUniformSetback(tier, n);
                                    }}
                                    aria-label={`${TIER_LABELS[tier]} setback (m)`}
                                  />
                                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">m</span>
                                </span>
                              </label>
                            )}
                            {sel === "setbacks" && mixed && (
                              <span className="text-[10.5px] text-ink-500 leading-snug">
                                Different per edge ({perEdge.map((v) => Number(v.toFixed(2))).join(" / ")} m, set in Massing → Site).
                                Typing a value here applies it to every edge.
                              </span>
                            )}
                            {sel === "setbacks" && blocks.length > 0 && (
                              <span className="text-[10.5px] text-ink-500 leading-snug">
                                {blocks.length} traced block{blocks.length === 1 ? " is" : "s are"} kept — pick Traced to use {blocks.length === 1 ? "it" : "them"} again.
                              </span>
                            )}

                            {sel !== "setbacks" && sel !== "traced" && (
                              <span className="text-ink-600 leading-snug">
                                Same geometry as the <strong>{TIER_LABELS[sel]}</strong>
                                {r.origin !== sel ? ` (which follows the ${TIER_LABELS[r.origin].toLowerCase()})` : ""} —{" "}
                                {r.source === "traced"
                                  ? `${r.polygons.length} traced block${r.polygons.length === 1 ? "" : "s"}`
                                  : "from its setbacks"}
                                . It changes whenever the {TIER_LABELS[r.origin].toLowerCase()} does.
                              </span>
                            )}

                            {sel === "traced" && (
                              <>
                                {blocks.map((poly, i) => (
                                  <div key={`${tier}-${i}`} className="flex items-center gap-2">
                                    <span className="text-ink-900">Block {i + 1}</span>
                                    <span className="flex-1 text-ink-500 tabular-nums">{fmt2(polygonArea(poly))} m²</span>
                                    <button
                                      className="btn btn-danger btn-xs"
                                      onClick={() => removeTierBlock(tier, i)}
                                      disabled={traceMode !== "idle"}
                                      title="Remove this block"
                                    >✕</button>
                                  </div>
                                ))}
                                {tracingThis ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-ink-900">Block {blocks.length + 1}</span>
                                    <span className="flex-1 text-ink-500 tabular-nums">
                                      {livePoints.length} point{livePoints.length === 1 ? "" : "s"}…
                                    </span>
                                    <button className="btn btn-primary btn-xs" onClick={finishTrace}>Done</button>
                                    <button className="btn btn-secondary btn-xs" onClick={cancelTrace}>Cancel</button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="flex-1 text-ink-500 leading-snug">
                                      {blocks.length === 0
                                        ? "Nothing traced yet — the setbacks are used until you trace a block."
                                        : `${blocks.length} block${blocks.length === 1 ? "" : "s"} — each is its own volume.`}
                                    </span>
                                    <button
                                      className="btn btn-secondary btn-xs shrink-0"
                                      onClick={() => startTierTrace(tier)}
                                      disabled={traceMode !== "idle"}
                                    >{blocks.length === 0 ? "Trace" : "+ Add block"}</button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          {/* Floors — a tier with none is not modelled in Massing */}
                          <div className={`px-2.5 py-1.5 border-t text-[11.5px] flex items-center gap-2 ${issue ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-bone-50/60"}`}>
                            {tier === "tower" ? (
                              <span className={issue ? "text-amber-900 leading-snug" : "text-ink-600"}>
                                {issue
                                  ? "0 floors — not modelled in Massing yet."
                                  : `${floors.tower} floor${floors.tower === 1 ? "" : "s"}` +
                                    (floors.towerOffice > 0 && floors.towerResidential > 0
                                      ? ` (${floors.towerResidential} residential + ${floors.towerOffice} office)`
                                      : floors.towerOffice > 0 ? " of offices" : "") +
                                    " — counted in Distribution"}
                              </span>
                            ) : (
                              <>
                                <span className={issue ? "text-amber-900" : "text-ink-600"}>
                                  {tier === "ground" ? "Levels" : "Podium levels"}
                                </span>
                                <input
                                  type="number" min={0} step={1}
                                  className="cell-input text-right !py-0.5 !px-1.5 !w-[56px]"
                                  value={tier === "ground" ? floors.ground : floors.podium}
                                  onChange={(e) => setTierLevels(tier, parseFloat(e.target.value))}
                                  aria-label={`${TIER_LABELS[tier]} levels`}
                                />
                                <span className={`leading-snug ${issue ? "text-amber-900" : "text-ink-500"}`}>
                                  {issue ? "0 levels — not modelled in Massing." : "same as Setup → Floor breakdown"}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(footprintsDiffer || tierIssues.some((i) => i.tier === "tower")) && (
                    <div className="border border-amber-200 bg-amber-50 text-amber-900 p-2.5 mt-3 text-[11.5px] leading-snug grid gap-2">
                      <span>
                        <strong>Tower floors are counted in Distribution</strong> from its own footprint
                        figures, which differ from this geometry:
                      </span>
                      <table className="w-full tabular-nums text-[11px]">
                        <thead>
                          <tr className="text-amber-900/70">
                            <th className="text-left font-normal"></th>
                            <th className="text-right font-normal">Plot</th>
                            <th className="text-right font-normal">Distribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {TIER_TARGETS.map((t) => (
                            <tr key={t}>
                              <td>{TIER_LABELS[t]}</td>
                              <td className="text-right">{fmt2(plotFp[t])} m²</td>
                              <td className="text-right">{distFp[t] > 0 ? `${fmt2(distFp[t])} m²` : "— not set"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        className="btn btn-primary btn-xs justify-self-start"
                        onClick={() => patch(footprintsPatch(project))}
                        disabled={traceMode !== "idle"}
                        title="Copy these three footprints into Distribution so floors, heights and the 3D follow this geometry"
                      >Use these footprints in Distribution</button>
                    </div>
                  )}
                  <p className="text-[10.5px] text-ink-500 mt-2 leading-snug">
                    <strong>= Ground / = Podium / = Tower</strong> makes a tier share another tier&apos;s
                    geometry and follow it. Tracing: click each corner on the drawing, then the first
                    point (or Done) to close. Per-edge setbacks are edited in Massing → Site. A traced
                    footprint must sit inside the plot for setbacks compliance — the app doesn&apos;t
                    enforce it.
                  </p>
                </StepBlock>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Subcomponents ---------- */

function StepBlock({
  step, title, description, children, done, disabled,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
  done?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`border ${done ? "border-emerald-200 bg-emerald-50/40" : "border-ink-200 bg-white"} p-3 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${done ? "bg-emerald-600 text-white" : "bg-ink-200 text-ink-700"}`}>
          {done ? "✓" : step}
        </span>
        <span className="eyebrow text-ink-700">{title}</span>
      </div>
      <p className="text-[11px] text-ink-500 mb-2 leading-relaxed">{description}</p>
      {children}
    </div>
  );
}

function Dropzone({
  onFiles, inputRef,
}: { onFiles: (f: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
      className={`block border-2 border-dashed text-center py-14 px-6 cursor-pointer transition-colors ${
        drag ? "border-qube-500 bg-qube-50" : "border-ink-200 bg-bone-50 hover:border-qube-400 hover:bg-qube-50/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <div className="mx-auto w-10 h-10 mb-4 flex items-center justify-center border border-ink-300 rounded-full">
        <svg className="w-5 h-5 text-ink-700" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 14V4M5 9l5-5 5 5M3 16h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="text-sm font-medium text-ink-900">Drop the plot drawing here, or click to browse</div>
      <div className="text-xs text-ink-500 mt-1">PDF, JPG, PNG · stored locally in your browser</div>
    </label>
  );
}

