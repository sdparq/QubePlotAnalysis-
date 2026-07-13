"use client";
/**
 * Floor-plan fit ("encaje en planta"): feasibility sketch of one tower floor —
 * communication core (lifts + stairs + lobby) and the floor's unit programme
 * from the Apartments matrix laid out around the perimeter, each unit sized
 * to its typology area.
 */
import { useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/types";
import type { Point } from "@/lib/geom";
import { computeFloorPlan, type FloorPlanResult, type UnitSpec } from "@/lib/floor-plan";
import { computeLifts } from "@/lib/calc/lifts";

const CAT_COLORS: Record<string, string> = {
  Studio: "#d9c98f",
  "1BR": "#a8bb8a",
  "2BR": "#7d9a6a",
  "3BR": "#5a7a4d",
  "4BR": "#42603a",
  Penthouse: "#31492c",
};
const CAT_TEXT_LIGHT = new Set(["3BR", "4BR", "Penthouse"]);

const fmt0 = (n: number) => Math.round(n).toLocaleString("en-US");

export default function FloorPlanFit({ project, towerPoly }: { project: Project; towerPoly: Point[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const floorsWithUnits = useMemo(() => {
    const tById = new Map(project.typologies.map((t) => [t.id, t]));
    const byFloor = new Map<number, number>();
    for (const c of project.program) {
      if (c.floor < 1 || c.floor > project.numFloors || !c.count || !tById.has(c.typologyId)) continue;
      byFloor.set(c.floor, (byFloor.get(c.floor) ?? 0) + c.count);
    }
    return byFloor;
  }, [project.program, project.typologies, project.numFloors]);

  const defaultFloor = useMemo(() => {
    for (let f = 1; f <= project.numFloors; f++) if ((floorsWithUnits.get(f) ?? 0) > 0) return f;
    return 1;
  }, [floorsWithUnits, project.numFloors]);

  const [floor, setFloor] = useState<number | null>(null);
  const activeFloor = floor ?? defaultFloor;

  const units = useMemo<UnitSpec[]>(() => {
    const tById = new Map(project.typologies.map((t) => [t.id, t]));
    const out: UnitSpec[] = [];
    const cells = project.program
      .filter((c) => c.floor === activeFloor && c.count > 0 && tById.has(c.typologyId));
    // Stable, mix-friendly order: biggest typologies first get the corners.
    const expanded = cells.flatMap((c) => {
      const t = tById.get(c.typologyId)!;
      return Array.from({ length: c.count }, (_, i) => ({ t, i }));
    });
    expanded.sort((a, b) => b.t.internalArea - a.t.internalArea);
    expanded.forEach(({ t, i }, idx) => {
      out.push({
        id: `${t.id}-${i}-${idx}`,
        label: t.category,
        category: t.category,
        area: t.internalArea,
        balcony: t.balconyArea,
      });
    });
    return out;
  }, [project.program, project.typologies, activeFloor]);

  const lifts = useMemo(() => {
    try {
      const r = computeLifts(project);
      return r.liftsRecommended > 0 ? r.liftsRecommended : 2;
    } catch {
      return 2;
    }
  }, [project]);

  const plan: FloorPlanResult = useMemo(
    () => computeFloorPlan(towerPoly, units, { lifts }),
    [towerPoly, units, lifts],
  );

  /* ------------------------------ svg mapping ----------------------------- */
  const view = useMemo(() => {
    const pts = plan.plate.length >= 3 ? plan.plate : towerPoly;
    if (pts.length < 3) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const M = 4.5; // margin (m) for balconies + labels
    const W = maxX - minX + M * 2;
    const H = maxY - minY + M * 2;
    const map = (p: Point) => ({ x: p.x - minX + M, y: maxY - p.y + M });
    return { W, H, map };
  }, [plan.plate, towerPoly]);

  function poly(points: Point[]): string {
    if (!view) return "";
    return points.map((p) => { const m = view.map(p); return `${m.x.toFixed(2)},${m.y.toFixed(2)}`; }).join(" ");
  }
  function centroidOf(points: Point[]): { x: number; y: number } {
    if (!view) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of points) { const m = view.map(p); sx += m.x; sy += m.y; }
    return { x: sx / points.length, y: sy / points.length };
  }

  /* ------------------------------ png export ------------------------------ */
  function downloadPNG() {
    const svg = svgRef.current;
    if (!svg || !view) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const scale = 1600 / view.W;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(view.W * scale);
      canvas.height = Math.round(view.H * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `floor-plan-L${activeFloor}.png`;
      a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  }

  /* -------------------------------- legend -------------------------------- */
  const legend = useMemo(() => {
    const acc = new Map<string, { count: number; area: number }>();
    for (const u of units) {
      const cur = acc.get(u.category) ?? { count: 0, area: 0 };
      acc.set(u.category, { count: cur.count + 1, area: cur.area + u.area });
    }
    return [...acc.entries()];
  }, [units]);

  const floorOptions = Array.from({ length: project.numFloors }, (_, i) => i + 1);

  return (
    <div className="card">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="section-title">Floor plan fit · typologies on the plate</h2>
          <p className="section-sub">
            Feasibility sketch of a tower floor: the communication core (lifts from the Lifts
            calculation + two escape stairs + lobby) and this floor&apos;s units from the Apartments
            matrix, each drawn at its typology area around the facade.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[11px] uppercase tracking-[0.10em] text-ink-500">
            Floor{" "}
            <select
              className="cell-input !py-1 !px-1.5 ml-1"
              value={activeFloor}
              onChange={(e) => setFloor(parseInt(e.target.value, 10))}
            >
              {floorOptions.map((f) => (
                <option key={f} value={f}>
                  L{f}{floorsWithUnits.get(f) ? ` · ${floorsWithUnits.get(f)} units` : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-secondary btn-xs" onClick={downloadPNG} disabled={!view || plan.units.length === 0}>
            ↓ PNG
          </button>
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12px] leading-snug mb-3 grid gap-1">
          {plan.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {view && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
          <div className="border border-ink-200 bg-white overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${view.W.toFixed(1)} ${view.H.toFixed(1)}`}
              className="w-full h-auto block"
              xmlns="http://www.w3.org/2000/svg"
              style={{ maxHeight: 640 }}
            >
              {/* circulation zone */}
              {plan.inner.length >= 3 && (
                <polygon points={poly(plan.inner)} fill="#efece3" stroke="none" />
              )}

              {/* units */}
              {plan.units.map((pu, i) => {
                const fill = CAT_COLORS[pu.spec.category] ?? "#b9c4a5";
                const dark = CAT_TEXT_LIGHT.has(pu.spec.category);
                const c = centroidOf(pu.polygon);
                // Facade width of the slice — narrow units get a rotated label
                // so a run of studios stays readable.
                const width = plan.stripDepth > 0 ? pu.areaAchieved / plan.stripDepth : 99;
                const mode = pu.areaAchieved < 14 ? "none" : width >= 4.6 ? "horizontal" : width >= 2.1 ? "vertical" : "none";
                const fgMain = dark ? "#f2f0e8" : "#26301f";
                const fgSub = dark ? "#e2e0d2" : "#3c4433";
                return (
                  <g key={pu.spec.id + i}>
                    <polygon
                      points={poly(pu.polygon)}
                      fill={fill}
                      fillOpacity={0.88}
                      stroke="#3c4433"
                      strokeWidth={0.12}
                    />
                    {pu.balconyQuads.map((q, j) => (
                      <polygon
                        key={j}
                        points={poly(q)}
                        fill={fill}
                        fillOpacity={0.28}
                        stroke="#3c4433"
                        strokeWidth={0.08}
                        strokeDasharray="0.55 0.4"
                      />
                    ))}
                    {mode === "horizontal" && (
                      <>
                        <text
                          x={c.x} y={c.y - 0.45}
                          textAnchor="middle"
                          fontSize={1.9}
                          fontFamily="system-ui, sans-serif"
                          fontWeight={600}
                          fill={fgMain}
                        >{pu.spec.label}</text>
                        <text
                          x={c.x} y={c.y + 1.75}
                          textAnchor="middle"
                          fontSize={1.35}
                          fontFamily="system-ui, sans-serif"
                          fill={fgSub}
                        >{fmt0(pu.areaAchieved)} m²</text>
                      </>
                    )}
                    {mode === "vertical" && (
                      <text
                        x={c.x} y={c.y}
                        textAnchor="middle"
                        fontSize={Math.min(1.5, width * 0.55)}
                        fontFamily="system-ui, sans-serif"
                        fontWeight={600}
                        fill={fgMain}
                        transform={`rotate(-90 ${c.x} ${c.y})`}
                      >{pu.spec.label} · {fmt0(pu.areaAchieved)}</text>
                    )}
                  </g>
                );
              })}

              {/* core */}
              {plan.core && (
                <g>
                  <polygon points={poly(plan.core.rect)} fill="#4a4a45" fillOpacity={0.15} stroke="#4a4a45" strokeWidth={0.18} />
                  {plan.core.parts.map((part, i) => {
                    const c = centroidOf(part.rect);
                    return (
                      <g key={i}>
                        <polygon
                          points={poly(part.rect)}
                          fill={part.kind === "lifts" ? "#5d6152" : part.kind === "stair" ? "#767b68" : "#d8d4c6"}
                          fillOpacity={part.kind === "lobby" ? 0.9 : 0.92}
                          stroke="#3c4433"
                          strokeWidth={0.12}
                        />
                        <text
                          x={c.x} y={c.y + 0.45}
                          textAnchor="middle"
                          fontSize={1.05}
                          fontFamily="system-ui, sans-serif"
                          fontWeight={600}
                          letterSpacing={0.12}
                          fill={part.kind === "lobby" ? "#4a4a45" : "#f2f0e8"}
                        >{part.label}</text>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* boundaries on top */}
              {plan.inner.length >= 3 && (
                <polygon points={poly(plan.inner)} fill="none" stroke="#6b7261" strokeWidth={0.1} strokeDasharray="0.8 0.5" />
              )}
              <polygon points={poly(plan.plate)} fill="none" stroke="#26301f" strokeWidth={0.3} />
            </svg>
          </div>

          <div className="grid gap-3 content-start">
            <div className="border border-ink-200">
              <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 eyebrow text-ink-500 text-[10px]">
                Floor L{activeFloor} · programme
              </div>
              <div className="p-3 grid gap-1.5">
                {legend.length === 0 && (
                  <div className="text-[12px] text-ink-500">No units on this floor.</div>
                )}
                {legend.map(([cat, v]) => (
                  <div key={cat} className="flex items-center gap-2 text-[12px] text-ink-800 tabular-nums">
                    <span
                      className="inline-block w-3.5 h-3.5 border border-ink-300 shrink-0"
                      style={{ background: CAT_COLORS[cat] ?? "#b9c4a5" }}
                    />
                    <span className="w-20">{cat}</span>
                    <span className="text-ink-500">× {v.count}</span>
                    <span className="ml-auto">{fmt0(v.area)} m²</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-ink-200">
              <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 eyebrow text-ink-500 text-[10px]">
                Fit check
              </div>
              <div className="p-3 grid gap-1.5 text-[12px] text-ink-800 tabular-nums">
                <Row k="Plate area" v={`${fmt0(plan.plateArea)} m²`} />
                <Row k="Units target" v={`${fmt0(plan.unitsTargetArea)} m²`} />
                <Row k="Units drawn" v={`${fmt0(plan.unitsAchievedArea)} m²`} />
                <Row k="Unit strip depth" v={plan.stripDepth > 0 ? `${plan.stripDepth.toFixed(1)} m` : "—"} />
                <Row k="Core (lifts + stairs)" v={plan.core ? `${fmt0(plan.core.areaM2)} m²` : "—"} />
                <Row k="Corridors / lobby" v={`${fmt0(plan.circulationArea)} m²`} />
                <Row k="Lifts in bank" v={`${lifts}`} />
              </div>
            </div>

            <p className="text-[10.5px] text-ink-500 leading-snug">
              Schematic fit, not a design: units are perimeter slices at their typology area,
              the dashed outer bands are balconies, and the core is sized from the Lifts
              calculation (2.0 × 2.6 m shafts) plus two escape stairs and a lobby.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}
