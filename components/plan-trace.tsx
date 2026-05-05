"use client";
import { useEffect, useRef, useState } from "react";
import type { ParcelInfo } from "@/lib/types";

export type TraceMode = "idle" | "tracing" | "calibrating";

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
}

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
}: PlanTraceProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    parcel.imageNaturalWidth && parcel.imageNaturalHeight
      ? { w: parcel.imageNaturalWidth, h: parcel.imageNaturalHeight }
      : null
  );

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [parcel.imageDataUrl]);

  function svgToImagePx(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  const cursor = mode === "idle" ? "default" : "crosshair";
  const W = dims?.w ?? 0;
  const H = dims?.h ?? 0;

  const tracePoints = tracePolygonPx ?? [];
  const liveVertexPath =
    mode === "tracing" && livePoints && livePoints.length > 0
      ? [...livePoints, hoverPoint ?? livePoints[livePoints.length - 1]]
      : null;

  return (
    <div className={`relative ${className}`} style={{ cursor }}>
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
            if (!onPick) return;
            const p = svgToImagePx(e.clientX, e.clientY);
            if (p) onPick(p);
          }}
          onMouseMove={(e) => {
            if (!onHover) return;
            const p = svgToImagePx(e.clientX, e.clientY);
            if (p) onHover(p);
          }}
          onMouseLeave={() => onHover?.(null)}
          style={{ pointerEvents: mode === "idle" ? "none" : "auto" }}
        >
          {/* Saved/finished trace polygon */}
          {tracePoints.length >= 2 && (
            <polygon
              points={tracePoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(100,125,87,0.15)"
              stroke="#3f5135"
              strokeWidth={Math.max(1.2, W * 0.0015)}
            />
          )}
          {tracePoints.map((p, i) => (
            <circle key={`v-${i}`} cx={p.x} cy={p.y} r={Math.max(3, W * 0.004)} fill="#3f5135" />
          ))}

          {/* Live tracing path */}
          {liveVertexPath && liveVertexPath.length >= 2 && (
            <polyline
              points={liveVertexPath.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#647d57"
              strokeWidth={Math.max(1.2, W * 0.0015)}
              strokeDasharray={`${W * 0.006},${W * 0.004}`}
            />
          )}
          {mode === "tracing" && livePoints?.map((p, i) => (
            <circle
              key={`l-${i}`}
              cx={p.x}
              cy={p.y}
              r={Math.max(4, W * 0.005)}
              fill={i === 0 ? "#a17e4c" : "#647d57"}
              stroke="white"
              strokeWidth={Math.max(0.8, W * 0.0008)}
            />
          ))}

          {/* Calibration markers */}
          {calibration && (
            <CalibrationDisplay calibration={calibration} W={W} />
          )}
          {mode === "calibrating" && livePoints && livePoints.length > 0 && (
            <CalibrationLive points={livePoints} hover={hoverPoint ?? null} W={W} />
          )}
        </svg>
      )}
    </div>
  );
}

function CalibrationDisplay({
  calibration,
  W,
}: { calibration: NonNullable<ParcelInfo["calibration"]>; W: number }) {
  const { p1, p2, metres } = calibration;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const r = Math.max(4, W * 0.005);
  const sw = Math.max(1.2, W * 0.0015);
  return (
    <g>
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#a17e4c" strokeWidth={sw} strokeDasharray={`${W * 0.005},${W * 0.003}`} />
      <circle cx={p1.x} cy={p1.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      <circle cx={p2.x} cy={p2.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      <rect
        x={mid.x - W * 0.04}
        y={mid.y - W * 0.012}
        width={W * 0.08}
        height={W * 0.024}
        fill="#fff8e7"
        stroke="#a17e4c"
        strokeWidth={sw * 0.6}
        rx={2}
      />
      <text
        x={mid.x}
        y={mid.y + W * 0.005}
        textAnchor="middle"
        fontSize={W * 0.018}
        fontWeight="600"
        fill="#574128"
      >{metres.toFixed(2)} m</text>
    </g>
  );
}

function CalibrationLive({
  points,
  hover,
  W,
}: { points: { x: number; y: number }[]; hover: { x: number; y: number } | null; W: number }) {
  const r = Math.max(4, W * 0.005);
  const sw = Math.max(1.2, W * 0.0015);
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
          strokeDasharray={`${W * 0.005},${W * 0.003}`}
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r} fill="#a17e4c" stroke="white" strokeWidth={sw * 0.7} />
      ))}
    </g>
  );
}
