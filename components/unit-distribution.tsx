"use client";
import { useMemo, useState } from "react";
import { type Point, polygonBBox } from "@/lib/geom";
import type { ProgramCell, Typology, UnitCategory } from "@/lib/types";

const CATEGORY_COLOR: Record<UnitCategory, string> = {
  Studio:    "#e3e34a",
  "1BR":     "#f4a3c4",
  "2BR":     "#ef6a5a",
  "3BR":     "#5fd1c5",
  "4BR":     "#a8d97a",
  Penthouse: "#c19bf2",
};

interface PlacedUnit {
  x: number; y: number; w: number; h: number;
  typology: Typology;
}

/* ----------------------------- Squarified treemap ----------------------------- */
/* Classic Bruls / Huijsmans / van Wijk (2000) algorithm. Lays out `items` sized
   by their `.area` so the rectangles approach unit aspect ratio. */

interface TreemapItem {
  area: number;
  payload: Typology;
}

interface Rect { x: number; y: number; w: number; h: number; }

function worst(row: number[], side: number): number {
  if (row.length === 0 || side === 0) return Infinity;
  const sum = row.reduce((s, x) => s + x, 0);
  const rMax = Math.max(...row);
  const rMin = Math.min(...row);
  const sumSq = sum * sum;
  const sideSq = side * side;
  return Math.max((sideSq * rMax) / sumSq, sumSq / (sideSq * rMin));
}

function layoutRow(row: TreemapItem[], rect: Rect): { placed: PlacedUnit[]; rest: Rect } {
  const sum = row.reduce((s, r) => s + r.area, 0);
  const placed: PlacedUnit[] = [];
  if (sum <= 0) return { placed, rest: rect };
  if (rect.w >= rect.h) {
    // Row laid out along left edge (vertical), width = sum/h.
    const w = sum / rect.h;
    let y = rect.y;
    for (const it of row) {
      const h = it.area / w;
      placed.push({ x: rect.x, y, w, h, typology: it.payload });
      y += h;
    }
    return { placed, rest: { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h } };
  }
  // Row laid out along top edge (horizontal), height = sum/w.
  const h = sum / rect.w;
  let x = rect.x;
  for (const it of row) {
    const w = it.area / h;
    placed.push({ x, y: rect.y, w, h, typology: it.payload });
    x += w;
  }
  return { placed, rest: { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h } };
}

function squarify(items: TreemapItem[], rect: Rect): PlacedUnit[] {
  const sorted = [...items].sort((a, b) => b.area - a.area).filter((it) => it.area > 0);
  const out: PlacedUnit[] = [];
  let row: TreemapItem[] = [];
  let cur: Rect = rect;
  for (const it of sorted) {
    const side = Math.min(cur.w, cur.h);
    const candidate = [...row, it].map((r) => r.area);
    if (row.length === 0 || worst(candidate, side) <= worst(row.map((r) => r.area), side)) {
      row.push(it);
    } else {
      const { placed, rest } = layoutRow(row, cur);
      out.push(...placed);
      cur = rest;
      row = [it];
    }
  }
  if (row.length > 0) {
    const { placed } = layoutRow(row, cur);
    out.push(...placed);
  }
  return out;
}

/* ----------------------------- Component ----------------------------- */

export interface UnitDistributionProps {
  towerPoly: Point[];
  program: ProgramCell[];
  typologies: Typology[];
  numFloors: number;
}

export default function UnitDistribution({ towerPoly, program, typologies, numFloors }: UnitDistributionProps) {
  const typologyById = useMemo(() => new Map(typologies.map((t) => [t.id, t])), [typologies]);
  const floors = useMemo(
    () => Array.from({ length: Math.max(1, numFloors) }, (_, i) => i + 1),
    [numFloors],
  );
  // Default floor = first floor with any units; otherwise floor 1.
  const defaultFloor = useMemo(() => {
    const sums = new Map<number, number>();
    for (const c of program) sums.set(c.floor, (sums.get(c.floor) ?? 0) + c.count);
    for (const f of floors) if ((sums.get(f) ?? 0) > 0) return f;
    return floors[0] ?? 1;
  }, [program, floors]);

  const [floor, setFloor] = useState<number>(defaultFloor);

  // Re-pick floor if the floor count drops.
  const effectiveFloor = Math.min(floor, floors.length || 1);

  // Build the list of (Typology, instance) for the selected floor.
  const cellsOnFloor = useMemo(
    () => program.filter((c) => c.floor === effectiveFloor && c.count > 0),
    [program, effectiveFloor],
  );

  // Per-typology summary for the legend.
  const perTypology = useMemo(() => {
    const map = new Map<string, { typology: Typology; units: number; areaM2: number }>();
    for (const c of cellsOnFloor) {
      const t = typologyById.get(c.typologyId);
      if (!t) continue;
      const prev = map.get(t.id) ?? { typology: t, units: 0, areaM2: 0 };
      prev.units += c.count;
      prev.areaM2 += c.count * t.internalArea;
      map.set(t.id, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.areaM2 - a.areaM2);
  }, [cellsOnFloor, typologyById]);

  const totalUnits = perTypology.reduce((s, x) => s + x.units, 0);
  const totalUnitArea = perTypology.reduce((s, x) => s + x.areaM2, 0);

  // Treemap input — one item per unit instance so each unit is its own rectangle.
  const items: TreemapItem[] = useMemo(() => {
    const out: TreemapItem[] = [];
    for (const c of cellsOnFloor) {
      const t = typologyById.get(c.typologyId);
      if (!t || t.internalArea <= 0) continue;
      for (let i = 0; i < c.count; i++) {
        out.push({ area: t.internalArea, payload: t });
      }
    }
    return out;
  }, [cellsOnFloor, typologyById]);

  const bbox = useMemo(() => polygonBBox(towerPoly), [towerPoly]);
  const towerW = bbox.maxX - bbox.minX;
  const towerD = bbox.maxY - bbox.minY;
  const towerArea = towerW * towerD;

  // Squarify into the tower bbox normalised area = towerArea.
  const placed: PlacedUnit[] = useMemo(() => {
    if (towerArea <= 0 || items.length === 0) return [];
    const totalItemArea = items.reduce((s, x) => s + x.area, 0);
    if (totalItemArea <= 0) return [];
    const k = towerArea / totalItemArea;
    const scaled: TreemapItem[] = items.map((it) => ({ area: it.area * k, payload: it.payload }));
    return squarify(scaled, { x: 0, y: 0, w: towerW, h: towerD });
  }, [items, towerArea, towerW, towerD]);

  /* SVG viewport */
  const padding = 12;
  const svgW = 760;
  const svgH = Math.max(220, Math.round((svgW * towerD) / Math.max(1, towerW)));
  const scale = Math.min((svgW - 2 * padding) / Math.max(1, towerW), (svgH - 2 * padding) / Math.max(1, towerD));
  const offsetX = padding + (svgW - 2 * padding - towerW * scale) / 2;
  const offsetY = padding + (svgH - 2 * padding - towerD * scale) / 2;

  // Polygon outline in svg coords.
  const outline = towerPoly.map((p) => ({
    x: offsetX + (p.x - bbox.minX) * scale,
    y: offsetY + (p.y - bbox.minY) * scale,
  }));
  const outlinePath = outline.length > 0
    ? `M ${outline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")} Z`
    : "";

  // Floors-with-data set for greying out empty buttons.
  const floorsWithData = useMemo(() => {
    const s = new Set<number>();
    for (const c of program) if (c.count > 0) s.add(c.floor);
    return s;
  }, [program]);

  if (typologies.length === 0) {
    return (
      <div className="border border-dashed border-ink-200 bg-bone-50 px-4 py-8 text-center text-[12px] text-ink-500 leading-snug">
        Define typologies and fill the Apartments matrix to see a per-floor unit distribution here.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {/* Floor selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="eyebrow text-ink-500 text-[10px]">Floor</span>
        <div className="inline-flex flex-wrap border border-ink-200 bg-white">
          {floors.map((f) => {
            const has = floorsWithData.has(f);
            const active = f === effectiveFloor;
            return (
              <button
                key={f}
                onClick={() => setFloor(f)}
                className={`px-2.5 py-1 text-[11px] font-medium tabular-nums border-r border-ink-200 last:border-r-0 transition-colors ${
                  active
                    ? "bg-ink-900 text-bone-100"
                    : has
                    ? "text-ink-700 hover:bg-bone-50"
                    : "text-ink-300 hover:bg-bone-50"
                }`}
              >{f}</button>
            );
          })}
        </div>
        <span className="text-[10.5px] text-ink-500 tabular-nums">
          {totalUnits} unit(s) · Σ {Math.round(totalUnitArea).toLocaleString("en-US")} m² ·
          footprint {Math.round(towerW)}m × {Math.round(towerD)}m ({Math.round(towerArea).toLocaleString("en-US")} m²)
        </span>
      </div>

      {/* SVG */}
      <div className="border border-ink-200 bg-bone-50">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full block"
          style={{ background: "#f5f4ee" }}
        >
          {/* Tower outline (background) */}
          {outlinePath && (
            <path d={outlinePath} fill="#ffffff" stroke="#3f5135" strokeWidth={1} />
          )}
          {/* Units */}
          {placed.map((u, i) => {
            const fill = CATEGORY_COLOR[u.typology.category] ?? "#cccccc";
            return (
              <g key={i}>
                <rect
                  x={(offsetX + u.x * scale).toFixed(1)}
                  y={(offsetY + u.y * scale).toFixed(1)}
                  width={(u.w * scale).toFixed(1)}
                  height={(u.h * scale).toFixed(1)}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={1}
                  opacity={0.92}
                />
                {u.w * scale > 28 && u.h * scale > 18 && (
                  <text
                    x={(offsetX + (u.x + u.w / 2) * scale).toFixed(1)}
                    y={(offsetY + (u.y + u.h / 2) * scale).toFixed(1)}
                    fontSize={10}
                    fill="#1f2a1a"
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ pointerEvents: "none", fontFamily: "ui-sans-serif, system-ui" }}
                  >
                    {u.typology.category}
                  </text>
                )}
              </g>
            );
          })}
          {placed.length === 0 && outlinePath && (
            <text
              x={svgW / 2}
              y={svgH / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fill="#94a37b"
              style={{ fontFamily: "ui-sans-serif, system-ui" }}
            >
              No units on floor {effectiveFloor}
            </text>
          )}
        </svg>
      </div>

      {/* Legend */}
      {perTypology.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
          {perTypology.map((row) => (
            <div key={row.typology.id} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 border border-ink-200"
                style={{ backgroundColor: CATEGORY_COLOR[row.typology.category] ?? "#cccccc" }}
              />
              <span className="text-ink-900">{row.typology.name}</span>
              <span className="text-ink-500 tabular-nums">
                · {row.units} ud × {row.typology.internalArea.toFixed(1)} m² ={" "}
                {Math.round(row.areaM2).toLocaleString("en-US")} m²
              </span>
            </div>
          ))}
          {totalUnitArea > 0 && towerArea > 0 && totalUnitArea < towerArea * 0.99 && (
            <div className="text-ink-500">
              · ≈ {Math.round(((towerArea - totalUnitArea) / towerArea) * 100)}% del footprint queda
              para circulación / core (no representada)
            </div>
          )}
          {totalUnitArea > towerArea * 1.01 && (
            <div className="text-amber-700">
              ⚠ Σ unit area excede la huella de la torre · revisa Setbacks o reduce unidades
            </div>
          )}
        </div>
      )}
    </div>
  );
}
