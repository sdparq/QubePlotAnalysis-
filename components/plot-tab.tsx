"use client";
import { useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import type { ParcelInfo } from "@/lib/types";
import { processParcel } from "@/lib/parcel-extract";
import { polygonArea, polygonCentroid, type Point } from "@/lib/geom";
import { fmt2 } from "@/lib/format";
import PlanTrace, { type TraceMode } from "./plan-trace";

type Phase = "idle" | "rendering" | "done" | "error";

export default function PlotTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const parcel = project.parcel;

  const [phase, setPhase] = useState<Phase>(parcel ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Trace state
  const [traceMode, setTraceMode] = useState<TraceMode>("idle");
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [calibInput, setCalibInput] = useState<string>("");

  // Vector candidates detected from PDF on upload (not persisted)
  const [candidates, setCandidates] = useState<Point[][]>([]);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhase("rendering");
      const result = await processParcel(file);
      const next: ParcelInfo = {
        fileName: file.name,
        fileType: file.type || "image/jpeg",
        imageDataUrl: result.imageDataUrl,
        uploadedAt: Date.now(),
        imageNaturalWidth: result.imageNaturalWidth,
        imageNaturalHeight: result.imageNaturalHeight,
      };
      patch({ parcel: next });
      setCandidates(result.candidatePolygons);
      // Auto-enter selecting mode if we found candidates
      if (result.candidatePolygons.length > 0) {
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
  }

  function selectCandidate(idx: number) {
    if (!parcel) return;
    const poly = candidates[idx];
    if (!poly || poly.length < 3) return;
    patch({ parcel: { ...parcel, tracePolygonPx: poly, calibration: undefined } });
    setTraceMode("idle");
    setCandidates([]);
  }

  /* ---------- Trace flow ---------- */
  function startTrace() {
    setTraceMode("tracing");
    setLivePoints([]);
  }
  function cancelTrace() {
    setTraceMode("idle");
    setLivePoints([]);
  }
  function finishTrace() {
    if (livePoints.length < 3) {
      alert("Click at least 3 corners to define a polygon.");
      return;
    }
    if (!parcel) return;
    patch({
      parcel: { ...parcel, tracePolygonPx: livePoints, calibration: undefined },
    });
    setTraceMode("idle");
    setLivePoints([]);
    // Polygon traced; user still needs to calibrate to get metres
  }
  function onTraceClick(p: { x: number; y: number }) {
    if (traceMode !== "tracing") return;
    // Click near first point closes the polygon
    if (livePoints.length >= 3) {
      const a = livePoints[0];
      const dist = Math.hypot(p.x - a.x, p.y - a.y);
      const W = parcel?.imageNaturalWidth ?? 1000;
      if (dist < W * 0.02) {
        // Close
        const final = livePoints;
        if (parcel) patch({ parcel: { ...parcel, tracePolygonPx: final, calibration: undefined } });
        setTraceMode("idle");
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
    const scale = metres / distPx; // metres per pixel
    // Convert traced polygon (px) -> metres, recentre on centroid, flip Y
    const inMetres = parcel.tracePolygonPx.map((p) => ({
      x: p.x * scale,
      y: -p.y * scale, // flip so visual top becomes +y
    }));
    const c = polygonCentroid(inMetres);
    const recentred = inMetres.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    const area = polygonArea(recentred);

    patch({
      parcel: { ...parcel, calibration: { p1, p2, metres } },
      plotMode: "polygon",
      plotPolygon: recentred,
      plotArea: project.plotArea > 0 ? project.plotArea : Math.round(area * 100) / 100,
    });
    setTraceMode("idle");
    setLivePoints([]);
    setCalibInput("");
  }

  function clearTrace() {
    if (!parcel) return;
    if (!confirm("Clear traced polygon and calibration?")) return;
    patch({ parcel: { ...parcel, tracePolygonPx: undefined, calibration: undefined } });
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

        {parcel && (phase === "done" || phase === "idle") && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
            {/* Image with overlay */}
            <div>
              <div className="border border-ink-200 bg-bone-50 overflow-hidden">
                <PlanTrace
                  parcel={parcel}
                  mode={traceMode}
                  tracePolygonPx={
                    traceMode === "idle" || traceMode === "calibrating"
                      ? parcel.tracePolygonPx
                      : undefined
                  }
                  calibration={traceMode === "idle" ? parcel.calibration : undefined}
                  livePoints={traceMode === "tracing" || traceMode === "calibrating" ? livePoints : undefined}
                  hoverPoint={hoverPoint}
                  candidates={traceMode === "selecting" ? candidates : undefined}
                  onSelectCandidate={selectCandidate}
                  onPick={(p) => {
                    if (traceMode === "tracing") onTraceClick(p);
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
                    {parcel.tracePolygonPx!.length} vertices captured{isCalibrated ? "" : " · awaiting calibration"}
                  </div>
                )}
              </StepBlock>

              <StepBlock
                step="2"
                title="Calibrate scale"
                done={isCalibrated}
                disabled={!hasTrace}
                description="Click two points on the drawing whose distance you can read from the cotas, then enter that distance in metres."
              >
                {!hasTrace ? (
                  <div className="text-[11px] text-ink-400">Trace the polygon first</div>
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
                {isCalibrated && parcel.calibration && (
                  <div className="mt-2 text-[11px] text-ink-500">
                    Reference: {parcel.calibration.metres.toFixed(2)} m between picked points
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

