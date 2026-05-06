"use client";
import type { Variant } from "@/lib/variants";
import type { Point } from "@/lib/geom";
import { polygonBBox } from "@/lib/geom";
import { fmt0, fmt2 } from "@/lib/format";

interface Props {
  variant: Variant;
  plot: Point[];
  buildable: Point[];
  programGFA: number;
  active?: boolean;
  onApply: () => void;
}

export default function VariantCard({ variant, plot, buildable, programGFA, active, onApply }: Props) {
  const delta = programGFA > 0 ? variant.totalGFA - programGFA : 0;
  const deltaPct = programGFA > 0 ? (delta / programGFA) * 100 : 0;

  return (
    <button
      type="button"
      onClick={onApply}
      className={`text-left border transition-colors p-3 grid gap-2 ${
        active
          ? "border-qube-500 bg-qube-50"
          : "border-ink-200 bg-white hover:border-qube-400 hover:bg-bone-50"
      }`}
    >
      <Thumbnail variant={variant} plot={plot} buildable={buildable} />

      <div className="text-[12px] font-medium text-ink-900 leading-tight">{variant.label}</div>

      <div className="grid grid-cols-3 gap-1 text-[10.5px] tabular-nums">
        <Cell label="GFA" value={`${fmt0(variant.totalGFA)} m²`} />
        <Cell
          label="vs prog"
          value={programGFA > 0 ? `${delta >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%` : "—"}
          tone={Math.abs(deltaPct) < 5 ? "good" : deltaPct < -10 ? "bad" : undefined}
        />
        <Cell label="H" value={`${fmt2(variant.buildingHeight)} m`} />
      </div>

      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 h-1.5 bg-ink-100 rounded-sm overflow-hidden">
          <div
            className="h-full bg-qube-500"
            style={{ width: `${Math.max(2, Math.min(100, variant.score.total))}%` }}
          />
        </div>
        <span className="text-[10.5px] text-ink-700 font-medium tabular-nums w-7 text-right">
          {variant.score.total}
        </span>
      </div>
    </button>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const cls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink-900";
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.10em] text-ink-500">{label}</div>
      <div className={`font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function Thumbnail({ variant, plot, buildable }: { variant: Variant; plot: Point[]; buildable: Point[] }) {
  const bbox = polygonBBox(plot);
  if (bbox.w <= 0 || bbox.h <= 0) return null;
  const padding = Math.max(bbox.w, bbox.h) * 0.06;
  const minX = bbox.minX - padding;
  const minY = bbox.minY - padding;
  const w = bbox.w + 2 * padding;
  const h = bbox.h + 2 * padding;

  const project = (p: Point) => ({ x: p.x - minX, y: h - (p.y - minY) });
  const points = (poly: Point[]) =>
    poly.map((p) => {
      const q = project(p);
      return `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    }).join(" ");

  const maxToY = Math.max(...variant.massing.volumes.map((v) => v.toY), 1);
  const colorFor = (toY: number) => {
    const t = Math.max(0.15, Math.min(1, toY / maxToY));
    const r = Math.round(180 - t * 110);
    const g = Math.round(190 - t * 80);
    const b = Math.round(140 - t * 60);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="aspect-[4/3] w-full bg-bone-50 border border-ink-200 overflow-hidden">
      <svg
        viewBox={`0 0 ${w.toFixed(2)} ${h.toFixed(2)}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <polygon
          points={points(plot)}
          fill="#ede9df"
          stroke="#bccab0"
          strokeWidth={Math.max(0.4, w * 0.0025)}
        />
        {buildable.length >= 3 && (
          <polygon points={points(buildable)} fill="#bccab0" opacity={0.55} stroke="none" />
        )}
        {[...variant.massing.volumes]
          .sort((a, b) => a.toY - b.toY)
          .map((v, i) => (
            <g key={i}>
              <polygon
                points={points(v.polygon)}
                fill={colorFor(v.toY)}
                stroke="#33422e"
                strokeWidth={Math.max(0.3, w * 0.0018)}
              />
              {v.hole && v.hole.length >= 3 && (
                <polygon
                  points={points(v.hole)}
                  fill="#ede9df"
                  stroke="#33422e"
                  strokeWidth={Math.max(0.3, w * 0.0018)}
                />
              )}
            </g>
          ))}
      </svg>
    </div>
  );
}
