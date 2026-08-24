"use client";
import { useEffect, useRef, useState } from "react";
import type { ParcelInfo } from "@/lib/types";

export type TraceMode = "idle" | "tracing" | "calibrating" | "selecting";

export interface PlanTraceProps {
  parcel: ParcelInfo;
  mode: TraceMode;
  /** Existing trace polygon in pixel coords (overlay only, not editable here) */
  tracePolygonPx?: { x: number; y: number }[];
  /** Existing calibration to display */
  calibration?: ParcelInfo["calibration"];
  /** Live points for the active operation (vertices being clicked or 2 calibration points) */
  livePoints?: { x: number; y: number }[];
  /** Receive a click in pixel coords */
  onPick?: (p: { x: number; y: number }) => void;
  /** Hover position for live preview lines (pixel coords) */
  onHover?: (p: { x: number; y: number } | null) => void;
  hoverPoint?: { x: number; y: number } | null;
  /** Visual variant */
  showOverlay?: boolean;
  className?: string;
  /** Candidate polygons (selecting mode): user picks one by clicking it */
  candidates?: { x: number; y: number }[][];
  onSelectCandidate?: (index: number) => void;
  /** Optional per-edge colors for the trace polygon outline. Length should match tracePolygonPx.length. */
  edgeColors?: string[];
  /** Extra display-only polygons (px coords) — e.g. traced tier footprints. */
  extraPolygons?: { points: { x: number; y: number }[]; color: string; label?: string }[];
}

const MAX_ZOOM = 8;

export default function PlanTrace({
  parcel,
  mode,
  tracePolygonPx,
  calibration,
  livePoints,
  onPick,
  onHover,
  hoverPoint,
  showOverlay = true,
  className = "",
  candidates,
  onSelectCandidate,
  edgeColors,
  extraPolygons,
}: PlanTraceProps) {
  const [hoveredCandidate, setHoveredCandidate] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    parcel.imageNaturalWidth && parcel.imageNaturalHeight
      ? { w: parcel.imageNaturalWidth, h: parcel.imageNaturalHeight }
      : null
  );

  /* ------------------------------ zoom & pan ------------------------------ */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;
  const [spaceUI, setSpaceUI] = useState(false);
  const spaceHeld = useRef(false);
  const hovering = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** When the last real pan ended — a click within CLICK_AFTER_PAN_MS of
   *  it is the drag's own click and must not place a vertex. */
  const dragEndedAt = useRef(0);

  function clampPan(x: number, y: number, k: number): { x: number; y: number } {
    const r = outerRef.current?.getBoundingClientRect();
    if (!r) return { x, y };
    return {
      x: Math.min(0, Math.max(r.width * (1 - k), x)),
      y: Math.min(0, Math.max(r.height * (1 - k), y)),
    };
  }

  function applyZoom(clientX: number, clientY: number, factor: number) {
    const r = outerRef.current?.getBoundingClientRect();
    if (!r) return;
    const k0 = zoomRef.current;
    const k1 = Math.min(MAX_ZOOM, Math.max(1, k0 * factor));
    if (k1 === k0) return;
    if (k1 === 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    const p0 = panRef.current;
    const next = clampPan(cx - (cx - p0.x) * (k1 / k0), cy - (cy - p0.y) * (k1 / k0), k1);
    setZoom(k1);
    setPan(next);
  }

  function zoomFromButtons(factor: number) {
    const r = outerRef.current?.getBoundingClientRect();
    if (!r) return;
    applyZoom(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Space = temporary pan mode while the cursor is over the plan (so panning
  // works mid-trace without stealing the click).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !hovering.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      spaceHeld.current = true;
      setSpaceUI(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceHeld.current = false;
      setSpaceUI(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Pointer handling: a PRESS never captures the pointer, so a plain click
  // always reaches the SVG and places a vertex. Only once the pointer has
  // travelled past DRAG_SLOP does it become a pan (capturing from there on).
  // That gives CAD behaviour at any zoom and in any mode — click to place,
  // drag to pan — instead of forcing SPACE while tracing.
  const DRAG_SLOP = 4;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.button !== 1) return;
    if (zoomRef.current <= 1 && !spaceHeld.current) return; // nothing to pan
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: panRef.current.x,
      oy: panRef.current.y,
      moved: false,
    };
    // Middle button / SPACE are explicit pan gestures — start panning at once.
    if (e.button === 1 || spaceHeld.current) {
      e.preventDefault();
      dragRef.current.moved = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setDragging(true);
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) <= DRAG_SLOP) return; // still a click
      d.moved = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setDragging(true);
    }
    setPan(clampPan(d.ox + dx, d.oy + dy, zoomRef.current));
  }
  function onPointerUp() {
    // Stamp the end of a real pan instead of latching a "swallow the next
    // click" flag: during a SPACE-pan the SVG has pointer-events:none, so the
    // click that would clear the flag never arrives and the flag would eat a
    // genuine vertex click later on. A timestamp expires by itself.
    if (dragRef.current?.moved) dragEndedAt.current = Date.now();
    dragRef.current = null;
    setDragging(false);
  }

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [parcel.imageDataUrl]);

  // Layout width of the (untransformed) img — clientWidth ignores the CSS
  // transform, so pxScale stays correct through zoom and window resizes.
  const [layoutW, setLayoutW] = useState(0);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => setLayoutW(img.clientWidth || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    return () => ro.disconnect();
  }, [parcel.imageDataUrl]);

  function svgToImagePx(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM(); // includes the zoom/pan transform
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  const panCursor = dragging ? "grabbing" : "grab";
  const cursor = spaceUI || dragging ? panCursor : mode === "idle" ? (zoom > 1 ? panCursor : "default") : "crosshair";
  const W = dims?.w ?? 0;
  const H = dims?.h ?? 0;
  // All marker/stroke sizes are specified in SCREEN pixels and converted to
  // viewBox units through the measured layout scale × zoom — dots and lines
  // stay crisp and constant-size no matter how large the source PDF is or
  // how far the user zooms.
  const pxScale = layoutW > 0 && W > 0 ? (layoutW / W) * Math.max(1, zoom) : 1;
  const px = (n: number) => n / pxScale;

  const tracePoints = tracePolygonPx ?? [];
  const liveVertexPath =
    mode === "tracing" && livePoints && livePoints.length > 0
      ? [...livePoints, hoverPoint ?? livePoints[livePoints.length - 1]]
      : null;

  return (
    <div
      ref={outerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => { hovering.current = true; }}
      onMouseLeave={() => { hovering.current = false; }}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
        className="relative"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={parcel.imageDataUrl}
          alt={parcel.fileName}
          className="w-full h-auto block select-none"
          draggable={false}
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth > 0) setDims({ w: im.naturalWidth, h: im.naturalHeight });
          }}
        />
        {showOverlay && W > 0 && H > 0 && (
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onClick={(e) => {
              if (Date.now() - dragEndedAt.current < 250) return; // click of a pan
              if (!onPick || spaceHeld.current) return;
              const p = svgToImagePx(e.clientX, e.clientY);
              if (p) onPick(p);
            }}
            onMouseMove={(e) => {
              if (!onHover) return;
              const p = svgToImagePx(e.clientX, e.clientY);
              if (p) onHover(p);
            }}
            onMouseLeave={() => onHover?.(null)}
            style={{ pointerEvents: mode === "idle" || spaceUI ? "none" : "auto" }}
          >
            {/* Saved/finished trace polygon — fill is uniform, edges may be colored */}
            {tracePoints.length >= 3 && (
              <polygon
                points={tracePoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="rgba(100,125,87,0.15)"
                stroke={edgeColors ? "none" : "#3f5135"}
                strokeWidth={px(1.6)}
              />
            )}
            {tracePoints.length >= 2 && tracePoints.map((p, i) => {
              const next = tracePoints[(i + 1) % tracePoints.length];
              const color = edgeColors?.[i] ?? "#3f5135";
              return (
                <line
                  key={`e-${i}`}
                  x1={p.x}
                  y1={p.y}
                  x2={next.x}
                  y2={next.y}
                  stroke={color}
                  strokeWidth={px(2.2)}
                  strokeLinecap="round"
                />
              );
            })}
            {tracePoints.map((p, i) => (
              <circle
                key={`v-${i}`}
                cx={p.x}
                cy={p.y}
                r={px(4.5)}
                fill={edgeColors?.[i] ?? "#3f5135"}
                stroke="white"
                strokeWidth={px(1.2)}
              />
            ))}

            {/* Extra display-only polygons (traced tier footprints) */}
            {extraPolygons?.map((ep, i) =>
              ep.points.length >= 3 ? (
                <g key={`xp-${i}`}>
                  <polygon
                    points={ep.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={ep.color}
                    strokeWidth={px(2.2)}
                    strokeDasharray={`${px(8)},${px(5)}`}
                  />
                  {ep.label && (
                    <text
                      x={ep.points.reduce((s, p) => s + p.x, 0) / ep.points.length}
                      y={ep.points.reduce((s, p) => s + p.y, 0) / ep.points.length}
                      textAnchor="middle"
                      fontSize={px(14)}
                      fontWeight="700"
                      fill={ep.color}
                      stroke="white"
                      strokeWidth={px(2.5)}
                      paintOrder="stroke"
                    >{ep.label}</text>
                  )}
                </g>
              ) : null,
            )}

            {/* Live tracing path */}
            {liveVertexPath && liveVertexPath.length >= 2 && (
              <polyline
                points={liveVertexPath.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#647d57"
                strokeWidth={px(2.4)}
                strokeDasharray={`${px(7)},${px(4)}`}
              />
            )}
            {mode === "tracing" && livePoints?.map((p, i) => (
              <circle
                key={`l-${i}`}
                cx={p.x}
                cy={p.y}
                r={i === 0 ? px(6.5) : px(5.5)}
                fill={i === 0 ? "#a17e4c" : "#647d57"}
                stroke="white"
                strokeWidth={px(1.5)}
              />
            ))}

            {/* Calibration markers */}
            {calibration && (
              <CalibrationDisplay calibration={calibration} px={px} />
            )}
            {mode === "calibrating" && livePoints && livePoints.length > 0 && (
              <CalibrationLive points={livePoints} hover={hoverPoint ?? null} px={px} />
            )}

            {/* Candidates from auto-detect — clickable */}
            {mode === "selecting" && candidates?.map((c, i) => {
              const hovered = hoveredCandidate === i;
              return (
                <polygon
                  key={`cand-${i}`}
                  points={c.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={hovered ? "rgba(100,125,87,0.35)" : "rgba(100,125,87,0.10)"}
                  stroke={hovered ? "#3f5135" : "#647d57"}
                  strokeWidth={px(2)}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (Date.now() - dragEndedAt.current < 250) return;
                    onSelectCandidate?.(i);
                  }}
                  onMouseEnter={() => setHoveredCandidate(i)}
                  onMouseLeave={() => setHoveredCandidate((v) => (v === i ? null : v))}
                />
              );
            })}
          </svg>
        )}
      </div>

      {/* Zoom controls */}
      {W > 0 && (
        <>
          <div
            className="absolute top-2 right-2 flex flex-col border border-ink-200 bg-white/95 shadow-sm z-10"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="w-7 h-7 text-[15px] leading-none text-ink-700 hover:bg-bone-100"
              onClick={() => zoomFromButtons(1.5)}
              title="Zoom in (or scroll)"
            >+</button>
            <button
              className="w-7 h-7 text-[15px] leading-none text-ink-700 hover:bg-bone-100 border-t border-ink-100"
              onClick={() => zoomFromButtons(1 / 1.5)}
              title="Zoom out"
            >−</button>
            <button
              className="w-7 h-7 text-[11px] leading-none text-ink-700 hover:bg-bone-100 border-t border-ink-100 disabled:opacity-30"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              disabled={zoom === 1}
              title="Fit to view"
            >⤢</button>
          </div>
          <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-white/85 border border-ink-200 text-[9.5px] text-ink-500 z-10 pointer-events-none select-none">
            {zoom > 1 ? `${zoom.toFixed(1)}× · ` : ""}scroll to zoom
            {zoom > 1 ? " · drag to pan · click to place" : ""}
          </div>
        </>
      )}
    </div>
  );
}

function CalibrationDisplay({
  calibration,
  px,
}: { calibration: NonNullable<ParcelInfo["calibration"]>; px: (n: number) => number }) {
  const { p1, p2, metres } = calibration;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const r = px(5.5);
  const sw = px(2);
  return (
    <g>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#a17e4c" strokeWidth={sw} strokeDasharray={`${px(6)},${px(4)}`} />
      <circle cx={p1.x} cy={p1.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      <circle cx={p2.x} cy={p2.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      <rect
        x={mid.x - px(38)}
        y={mid.y - px(12)}
        width={px(76)}
        height={px(24)}
        fill="#fff8e7"
        stroke="#a17e4c"
        strokeWidth={sw * 0.6}
        rx={px(2)}
      />
      <text
        x={mid.x}
        y={mid.y + px(5)}
        textAnchor="middle"
        fontSize={px(13)}
        fontWeight="600"
        fill="#574128"
      >{metres.toFixed(2)} m</text>
    </g>
  );
}

function CalibrationLive({
  points,
  hover,
  px,
}: { points: { x: number; y: number }[]; hover: { x: number; y: number } | null; px: (n: number) => number }) {
  const r = px(5.5);
  const sw = px(2);
  const second = points.length === 1 ? hover : points[1];
  return (
    <g>
      {points[0] && second && (
        <line
          x1={points[0].x}
          y1={points[0].y}
          x2={second.x}
          y2={second.y}
          stroke="#a17e4c"
          strokeWidth={sw}
          strokeDasharray={`${px(6)},${px(4)}`}
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      ))}
    </g>
  );
}
