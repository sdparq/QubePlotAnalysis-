"use client";
/**
 * Feasibility report — a print-designed document covering every tab of the
 * app (site, setup, distribution, typologies, apartments, parking, lifts,
 * areas & efficiency). Rendered in an overlay; "Save as PDF" goes through the
 * browser's print engine, so the output is a crisp vector A4 PDF.
 */
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useProject } from "@/lib/store";
import { useZoneLibrary } from "@/lib/use-zone-library";
import { classForZone } from "@/lib/zone-classes";
import { computeProgram } from "@/lib/calc/program";
import { computeParking } from "@/lib/calc/parking";
import { computeLifts } from "@/lib/calc/lifts";
import { computeTowerYield } from "@/lib/calc/tower-yield";
import {
  hospitalityGFA,
  residentialSubPct,
  residentialSubQuota,
  residentialGFATarget,
} from "@/lib/calc/gfa";
import {
  type Point,
  offsetPolygon,
  polygonArea,
  rectanglePlotPolygon,
} from "@/lib/geom";
import type { GfaUseCategory } from "@/lib/types";

const M2_TO_SQFT = 10.7639;
const fmt0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const fmt1 = (n: number) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString("en-US") : "—");
const m2 = (n: number) => (n > 0 ? `${fmt0(n)} m²` : "—");
const sqft = (n: number) => (n > 0 ? `${fmt0(n * M2_TO_SQFT)} sqft` : "—");
const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

/* ------------------------------ building blocks --------------------------- */

function Sec({ num, title, sub, children, breakBefore = true }: {
  num: string; title: string; sub?: string; children: React.ReactNode; breakBefore?: boolean;
}) {
  return (
    <section className={`${breakBefore ? "rpt-page-break" : ""} mb-10`}>
      <div className="flex items-baseline gap-3 border-b-2 border-ink-900 pb-2 mb-1">
        <span className="text-[13px] font-semibold text-qube-700 tabular-nums">{num}</span>
        <h2 className="text-[19px] font-medium tracking-tight text-ink-900">{title}</h2>
      </div>
      {sub && <p className="text-[10.5px] text-ink-500 mb-4 leading-snug">{sub}</p>}
      {!sub && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`border p-3 rpt-avoid-break ${accent ? "border-qube-600 bg-qube-50" : "border-ink-200 bg-white"}`}>
      <div className="text-[8.5px] uppercase tracking-[0.18em] text-ink-500">{label}</div>
      <div className={`text-[19px] font-light tabular-nums mt-0.5 ${accent ? "text-qube-800" : "text-ink-900"}`}>{value}</div>
      {sub && <div className="text-[9.5px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Tbl({ head, rows, foot, right = [] }: {
  head: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
  /** column indexes to right-align (numbers) */
  right?: number[];
}) {
  const align = (i: number) => (right.includes(i) ? "text-right" : "text-left");
  return (
    <table className="w-full text-[10.5px] tabular-nums border border-ink-200 rpt-avoid-break">
      <thead>
        <tr className="bg-ink-900 text-bone-100">
          {head.map((h, i) => (
            <th key={i} className={`px-2.5 py-1.5 font-medium text-[9px] uppercase tracking-[0.10em] ${align(i)}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className={ri % 2 ? "bg-bone-50/70" : "bg-white"}>
            {r.map((c, ci) => (
              <td key={ci} className={`px-2.5 py-1.5 border-t border-ink-100 text-ink-800 ${align(ci)}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot && (
        <tfoot>
          <tr className="bg-qube-50 border-t-2 border-qube-600">
            {foot.map((c, ci) => (
              <td key={ci} className={`px-2.5 py-1.5 font-semibold text-qube-900 ${align(ci)}`}>{c}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ------------------------------- site diagram ----------------------------- */

function resolveEdges(plot: Point[], uniform: number, perEdge?: number[]): number[] {
  if (perEdge && perEdge.length === plot.length) return perEdge.map((v) => Math.max(0, v));
  return plot.map(() => Math.max(0, uniform));
}

function SiteDiagram({ plot, tiers }: {
  plot: Point[];
  tiers: { label: string; poly: Point[]; color: string; dash?: string }[];
}) {
  if (plot.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of plot) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const M = 4;
  const W = maxX - minX + M * 2;
  const H = maxY - minY + M * 2;
  const map = (p: Point) => `${(p.x - minX + M).toFixed(2)},${(maxY - p.y + M).toFixed(2)}`;
  return (
    <svg viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`} className="w-full h-auto">
      <polygon points={plot.map(map).join(" ")} fill="#f0ede4" stroke="#26301f" strokeWidth={0.45} />
      {tiers.map((t, i) =>
        t.poly.length >= 3 ? (
          <polygon
            key={i}
            points={t.poly.map(map).join(" ")}
            fill="none"
            stroke={t.color}
            strokeWidth={0.35}
            strokeDasharray={t.dash}
          />
        ) : null,
      )}
    </svg>
  );
}

function SectionDiagram({ tiers }: {
  tiers: { label: string; floors: number; height: number; color: string; below?: boolean }[];
}) {
  const above = tiers.filter((t) => !t.below && t.height > 0);
  const below = tiers.filter((t) => t.below && t.height > 0);
  const totalAbove = above.reduce((s, t) => s + t.height, 0);
  const totalBelow = below.reduce((s, t) => s + t.height, 0);
  const total = totalAbove + totalBelow;
  if (total <= 0) return null;
  const SCALE = 150 / Math.max(1, total); // px per metre, fits ~150px tall
  const W = 190;
  const widths: Record<string, number> = { Tower: 90, Podium: 140, Ground: 140, Basement: 160 };
  let y = 8;
  const rects: { x: number; y: number; w: number; h: number; t: (typeof tiers)[number] }[] = [];
  // `above` arrives top-first (Tower, Podium, Ground) — draw in that order.
  for (const t of above) {
    const h = t.height * SCALE;
    const w = widths[t.label] ?? 120;
    rects.push({ x: (W - w) / 2, y, w, h, t });
    y += h;
  }
  const groundY = y;
  for (const t of below) {
    const h = t.height * SCALE;
    const w = widths[t.label] ?? 150;
    rects.push({ x: (W - w) / 2, y, w, h, t });
    y += h;
  }
  return (
    <svg viewBox={`0 0 ${W + 130} ${y + 12}`} className="w-full h-auto">
      {rects.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.t.color} stroke="#26301f" strokeWidth={0.7} />
          <text x={W + 6} y={r.y + r.h / 2 + 3} fontSize={9} fill="#3c4433" fontFamily="system-ui">
            {r.t.label}{r.t.floors > 0 ? ` · ${r.t.floors}F` : ""} — {fmt1(r.t.height)} m
          </text>
        </g>
      ))}
      <line x1={0} y1={groundY} x2={W + 4} y2={groundY} stroke="#26301f" strokeWidth={1.1} />
      <text x={2} y={groundY - 3} fontSize={8} fill="#6b7261" fontFamily="system-ui">±0.00</text>
    </svg>
  );
}

/* --------------------------------- document ------------------------------- */

function ReportDocument() {
  const project = useProject();
  const { library } = useZoneLibrary();

  const detectedClass = useMemo(() => classForZone(project.zone, library), [project.zone, library]);
  const program = useMemo(() => computeProgram(project), [project]);
  const parking = useMemo(() => computeParking(project), [project]);
  const lifts = useMemo(() => computeLifts(project), [project]);
  const yield_ = useMemo(() => computeTowerYield(project), [project]);

  const target = project.targetGFA ?? 0;
  const resGFA = residentialGFATarget(project);
  const hospM2 = hospitalityGFA(project);

  function useM2(key: GfaUseCategory): number {
    const item = project.gfaBreakdown?.[key];
    if (!item) return 0;
    return item.mode === "absolute" ? item.value : (item.value / 100) * target;
  }
  const retailM2 = useM2("retail");
  const commercialM2 = useM2("commercial");
  const otherUsesGFA = retailM2 + commercialM2;
  const totalGFA = resGFA + otherUsesGFA;

  // Construction BUA + GSA — same math as Areas Summary.
  const aptPct = residentialSubPct(project, "apartments");
  const aptInterior = residentialSubQuota(project, "apartments");
  const amenitiesBUA = residentialSubQuota(project, "amenities");
  const circulationBUA = residentialSubQuota(project, "circulation");
  const servicesBUA = residentialSubQuota(project, "services");
  const balconyShare = program.totalInteriorGFA > 0 ? program.totalBalcony / program.totalInteriorGFA : 0;
  const balconiesBUA = aptInterior * balconyShare;
  const groundPodiumShell = yield_.groundGFA + yield_.podiumGFA;
  const groundPodiumBUA = groundPodiumShell > 0 ? groundPodiumShell : otherUsesGFA;
  const basementCount = project.basements?.count ?? 0;
  const basementFootprint = project.basementFootprintM2 ?? project.plotArea ?? 0;
  const basementsBUA = basementCount * basementFootprint;
  const constructionBUA =
    aptInterior + balconiesBUA + amenitiesBUA + circulationBUA + servicesBUA + groundPodiumBUA + basementsBUA;
  const gsa = aptInterior + balconiesBUA;

  // Geometry for diagrams.
  const plotPoly: Point[] = useMemo(() => {
    if (project.plotMode === "polygon" && (project.plotPolygon?.length ?? 0) >= 3) return project.plotPolygon!;
    const sq = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
    return rectanglePlotPolygon(project.plotFrontage || sq, project.plotDepth || sq);
  }, [project.plotMode, project.plotPolygon, project.plotArea, project.plotFrontage, project.plotDepth]);

  const tierPoly = (custom: Point[] | undefined, uniform: number, perEdge?: number[]): Point[] => {
    if ((custom?.length ?? 0) >= 3) return custom!;
    const edges = resolveEdges(plotPoly, uniform, perEdge);
    if (edges.every((e) => e <= 0)) return plotPoly;
    return offsetPolygon(plotPoly, edges);
  };
  const groundPoly = tierPoly(project.groundPolygon, project.groundSetbackM ?? 3, project.groundSetbackPerEdge);
  const podiumPoly = tierPoly(project.podiumPolygon, project.podiumSetbackM ?? 3, project.podiumSetbackPerEdge);
  const towerPoly = tierPoly(project.towerPolygon, project.towerSetbackM ?? 6, project.towerSetbackPerEdge);

  const groundCount = project.ground?.count ?? 1;
  const groundHeight = project.ground?.heightM ?? 4.5;
  const podiumCount = project.podium?.count ?? 0;
  const podiumHeight = project.podium?.heightM ?? 4.0;
  const towerCount = project.typeFloors?.count ?? project.numFloors;
  const towerHeight = project.typeFloors?.heightM ?? project.floorHeight;
  const basementHeight = project.basements?.heightM ?? 3.0;
  const totalHeightM = groundCount * groundHeight + podiumCount * podiumHeight + towerCount * towerHeight;
  const far = project.plotArea > 0 ? totalGFA / project.plotArea : 0;

  const now = new Date();
  const classRow = detectedClass ? library[detectedClass] : null;

  const mixShare = (tId: string): number => {
    const byId = project.typologyMixById?.[tId];
    if (byId !== undefined) return byId;
    const t = project.typologies.find((x) => x.id === tId);
    if (!t) return 0;
    const ts = program.byTypology.find((x) => x.typology.id === tId);
    return program.totalUnits > 0 && ts ? (ts.totalUnits / program.totalUnits) * 100 : 0;
  };

  const ratios: [string, number, number][] = [
    ["GSA / GFA", gsa, totalGFA],
    ["GFA / BUA", totalGFA, constructionBUA],
    ["GSA / BUA", gsa, constructionBUA],
  ];

  return (
    <div id="print-report" className="bg-white text-ink-900 w-[820px] mx-auto shadow-2xl print:shadow-none">
      {/* ─────────────────────────────── Cover ─────────────────────────────── */}
      <div className="bg-ink-900 text-bone-100 px-10 pt-12 pb-10 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent 96%, #8faa78 96%), linear-gradient(90deg, transparent 96%, #8faa78 96%)",
            backgroundSize: "34px 34px",
          }}
        />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.4em] text-qube-500 mb-8">
            Plot Feasibility · Residential Study
          </div>
          <h1 className="text-[42px] leading-[1.05] font-light tracking-tight mb-4">{project.name}</h1>
          <div className="flex items-center gap-3 text-[12px] text-bone-200/85 flex-wrap">
            {project.zone && <span>{project.zone}</span>}
            {classRow && detectedClass && (
              <span className="px-2 py-0.5 border border-qube-500/60 text-qube-300 text-[10px] uppercase tracking-[0.14em]">
                Class {detectedClass} · {classRow.name}
              </span>
            )}
            <span className="text-bone-200/50">
              {now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        </div>
        <div className="relative grid grid-cols-4 gap-px bg-bone-100/15 border border-bone-100/15 mt-10">
          {[
            ["Plot area", m2(project.plotArea)],
            ["GFA total", m2(totalGFA)],
            ["Sellable GSA", m2(gsa)],
            ["Construction BUA", m2(constructionBUA)],
            ["Units", program.totalUnits > 0 ? fmt0(program.totalUnits) : "—"],
            ["Floors above ground", fmt0(groundCount + podiumCount + towerCount)],
            ["Height", totalHeightM > 0 ? `${fmt1(totalHeightM)} m` : "—"],
            ["FAR", far > 0 ? far.toFixed(2) : "—"],
          ].map(([l, v]) => (
            <div key={l} className="bg-ink-900 px-3 py-3">
              <div className="text-[8px] uppercase tracking-[0.18em] text-bone-200/50">{l}</div>
              <div className="text-[17px] font-light tabular-nums text-bone-100 mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-10 py-8">
        {/* ───────────────────────── 01 Site & plot ─────────────────────── */}
        <Sec num="01" title="Site & plot" breakBefore={false}
          sub="Plot geometry with the ground / podium / tower footprints used by the massing study.">
          <div className="grid grid-cols-[1.35fr_1fr] gap-6 items-start">
            <div className="border border-ink-200 p-3 bg-white rpt-avoid-break">
              <SiteDiagram
                plot={plotPoly}
                tiers={[
                  { label: "Ground", poly: groundPoly, color: "#8a9a76", dash: "1.6 1" },
                  { label: "Podium", poly: podiumPoly, color: "#a17e4c", dash: "1.6 1" },
                  { label: "Tower", poly: towerPoly, color: "#3f5135" },
                ]}
              />
              <div className="flex gap-4 mt-2 text-[9px] text-ink-500 uppercase tracking-[0.12em]">
                <span><span className="inline-block w-2.5 h-2.5 bg-[#f0ede4] border border-ink-900 mr-1.5 align-middle" />Plot</span>
                <span><span className="inline-block w-2.5 h-0.5 bg-[#8a9a76] mr-1.5 align-middle" />Ground</span>
                <span><span className="inline-block w-2.5 h-0.5 bg-[#a17e4c] mr-1.5 align-middle" />Podium</span>
                <span><span className="inline-block w-2.5 h-0.5 bg-[#3f5135] mr-1.5 align-middle" />Tower</span>
              </div>
            </div>
            <div className="grid gap-3">
              <Tbl
                head={["Footprint", "m²", "sqft"]}
                right={[1, 2]}
                rows={[
                  ["Plot", fmt0(project.plotArea || polygonArea(plotPoly)), fmt0((project.plotArea || polygonArea(plotPoly)) * M2_TO_SQFT)],
                  ["Ground", fmt0(polygonArea(groundPoly)), fmt0(polygonArea(groundPoly) * M2_TO_SQFT)],
                  ["Podium", fmt0(polygonArea(podiumPoly)), fmt0(polygonArea(podiumPoly) * M2_TO_SQFT)],
                  ["Tower", fmt0(polygonArea(towerPoly)), fmt0(polygonArea(towerPoly) * M2_TO_SQFT)],
                ]}
              />
              {project.parcel?.calibration && (
                <p className="text-[9.5px] text-ink-500 leading-snug">
                  Traced from “{project.parcel.fileName}” and calibrated against a{" "}
                  {project.parcel.calibration.metres.toFixed(2)} m reference.
                </p>
              )}
            </div>
          </div>
        </Sec>

        {/* ─────────────────────── 02 Programme brief ────────────────────── */}
        <Sec num="02" title="Programme brief" breakBefore={true}
          sub="Target GFA split across uses (Setup) and the vertical floor stack. Hospitality is operated as residential stock.">
          <div className="grid grid-cols-2 gap-6 items-start">
            <Tbl
              head={["Use", "GFA m²", "sqft", "% of target"]}
              right={[1, 2, 3]}
              rows={[
                [hospM2 > 0 ? "Residential (incl. hospitality)" : "Residential", fmt0(resGFA), fmt0(resGFA * M2_TO_SQFT), target > 0 ? pct((resGFA / target) * 100) : "—"],
                ...(retailM2 > 0 ? [["Retail", fmt0(retailM2), fmt0(retailM2 * M2_TO_SQFT), target > 0 ? pct((retailM2 / target) * 100) : "—"]] : []),
                ...(commercialM2 > 0 ? [["Commercial / office", fmt0(commercialM2), fmt0(commercialM2 * M2_TO_SQFT), target > 0 ? pct((commercialM2 / target) * 100) : "—"]] : []),
              ] as (string | number)[][]}
              foot={["Σ vs target " + (target > 0 ? fmt0(target) + " m²" : "—"), fmt0(totalGFA), fmt0(totalGFA * M2_TO_SQFT), target > 0 ? pct((totalGFA / target) * 100) : "—"]}
            />
            <div className="grid gap-3">
              <Tbl
                head={["Stack", "Floors", "Floor h (m)", "Height (m)"]}
                right={[1, 2, 3]}
                rows={[
                  ...(basementCount > 0 ? [["Basement", fmt0(basementCount), fmt1(basementHeight), fmt1(basementCount * basementHeight)]] : []),
                  ["Ground", fmt0(groundCount), fmt1(groundHeight), fmt1(groundCount * groundHeight)],
                  ...(podiumCount > 0 ? [["Podium", fmt0(podiumCount), fmt1(podiumHeight), fmt1(podiumCount * podiumHeight)]] : []),
                  ["Tower (type floors)", fmt0(towerCount), fmt1(towerHeight), fmt1(towerCount * towerHeight)],
                ] as (string | number)[][]}
                foot={["Above ground", fmt0(groundCount + podiumCount + towerCount), "", fmt1(totalHeightM)]}
              />
              <div className="border border-ink-200 p-3 bg-white rpt-avoid-break">
                <SectionDiagram
                  tiers={[
                    { label: "Tower", floors: towerCount, height: towerCount * towerHeight, color: "#647d57" },
                    { label: "Podium", floors: podiumCount, height: podiumCount * podiumHeight, color: "#a3b08a" },
                    { label: "Ground", floors: groundCount, height: groundCount * groundHeight, color: "#8a9a76" },
                    { label: "Basement", floors: basementCount, height: basementCount * basementHeight, color: "#bdb9ad", below: true },
                  ]}
                />
              </div>
            </div>
          </div>
        </Sec>

        {/* ─────────────────────── 03 Distribution ───────────────────────── */}
        <Sec num="03" title="Distribution" breakBefore={false}
          sub="How the residential GFA lands on the tower, and its split into apartments and common areas.">
          <div className="grid grid-cols-2 gap-6 items-start">
            <Tbl
              head={["Tier", "Plate m²", "Floors", "GFA m²"]}
              right={[1, 2, 3]}
              rows={[
                ["Ground", yield_.groundFootprintM2 > 0 ? fmt0(yield_.groundFootprintM2) : "—", fmt0(yield_.groundCount), yield_.groundGFA > 0 ? fmt0(yield_.groundGFA) : "—"],
                ["Podium", yield_.podiumFootprintM2 > 0 ? fmt0(yield_.podiumFootprintM2) : "—", fmt0(yield_.podiumCount), yield_.podiumGFA > 0 ? fmt0(yield_.podiumGFA) : "—"],
                ["Tower", yield_.towerFootprintM2 > 0 ? fmt0(yield_.towerFootprintM2) : "—", fmt0(yield_.towerFloors), yield_.towerGFA > 0 ? fmt0(yield_.towerGFA) : "—"],
              ]}
              foot={["Residential GFA to place", "", "", fmt0(yield_.residentialGFA)]}
            />
            <Tbl
              head={["Residential split", "%", "m²", "counts as"]}
              right={[1, 2]}
              rows={[
                ["Apartments", pct(aptPct), fmt0(aptInterior), "GFA"],
                ["Amenities", pct(residentialSubPct(project, "amenities")), fmt0(amenitiesBUA), "GFA"],
                ["Circulation", pct(residentialSubPct(project, "circulation")), fmt0(circulationBUA), "GFA"],
                ["Services (MEP)", pct(residentialSubPct(project, "services")), fmt0(servicesBUA), "BUA only"],
              ]}
            />
          </div>
        </Sec>

        {/* ─────────────────── 04 Typologies & unit mix ──────────────────── */}
        <Sec num="04" title="Typologies & unit mix"
          sub="The unit catalogue for this project — areas, balcony shares and each typology's slice of the total unit count.">
          <Tbl
            head={["Typology", "Category", "Total m²", "Interior m²", "Balcony", "Mix %", "Occupancy", "Parking/unit"]}
            right={[2, 3, 4, 5, 6, 7]}
            rows={project.typologies.map((t) => [
              t.name,
              t.category,
              fmt1(t.internalArea + t.balconyArea),
              fmt1(t.internalArea),
              t.internalArea + t.balconyArea > 0 ? pct((t.balconyArea / (t.internalArea + t.balconyArea)) * 100) : "—",
              pct(mixShare(t.id)),
              fmt1(t.occupancy),
              fmt1(t.parkingPerUnit),
            ])}
          />
        </Sec>

        {/* ─────────────────── 05 Apartments programme ───────────────────── */}
        <Sec num="05" title="Apartments programme" breakBefore={false}
          sub="Units placed in the matrix, by typology and by floor.">
          <div className="grid grid-cols-4 gap-3 mb-4">
            <Tile label="Units" value={fmt0(program.totalUnits)} accent />
            <Tile label="Interior GFA" value={m2(program.totalInteriorGFA)} sub={sqft(program.totalInteriorGFA)} />
            <Tile label="Balconies" value={m2(program.totalBalcony)} sub={sqft(program.totalBalcony)} />
            <Tile label="Sellable" value={m2(program.totalSellable)} sub={sqft(program.totalSellable)} />
          </div>
          <div className="grid grid-cols-2 gap-6 items-start">
            <Tbl
              head={["Typology", "Units", "Interior m²", "Sellable m²"]}
              right={[1, 2, 3]}
              rows={program.byTypology
                .filter((r) => r.totalUnits > 0)
                .map((r) => [r.typology.name, fmt0(r.totalUnits), fmt0(r.totalInteriorGFA), fmt0(r.totalSellable)])}
              foot={["Total", fmt0(program.totalUnits), fmt0(program.totalInteriorGFA), fmt0(program.totalSellable)]}
            />
            <Tbl
              head={["Floor", "Units", "Interior m²", "Sellable m²"]}
              right={[1, 2, 3]}
              rows={program.byFloor
                .filter((f) => f.units > 0)
                .map((f) => [`L${f.floor}`, fmt0(f.units), fmt0(f.totalInteriorGFA), fmt0(f.totalSellable)])}
            />
          </div>
        </Sec>

        {/* ────────────────────────── 06 Parking ─────────────────────────── */}
        <Sec num="06" title="Parking"
          sub="Required spaces from the unit mix, retail standard and POD rule, against the provided capacity.">
          <div className="grid grid-cols-2 gap-6 items-start">
            <Tbl
              head={["Demand", "Basis", "Spaces"]}
              right={[2]}
              rows={[
                ...parking.requiredByCategory.map((r) => [
                  `Residential · ${r.category}`,
                  `${fmt0(r.units)} units × ${fmt1(r.ratio)}`,
                  fmt0(r.required),
                ]),
                ...(parking.retailRequired > 0
                  ? [["Retail", `${fmt0(parking.retailM2)} m² ÷ ${fmt0(parking.retailM2PerSpaceUsed)} m²/space`, fmt0(parking.retailRequired)]]
                  : []),
                ...parking.otherUsesRequired.map((r) => [r.name, `${fmt0(r.netArea)} m²`, fmt0(r.required)]),
                ["POD (accessible)", "DCD tier rule — additional", fmt0(parking.requiredPOD)],
              ] as (string | number)[][]}
              foot={["Required total", "", fmt0(parking.grandRequiredWithPOD)]}
            />
            <div className="grid gap-3">
              <Tbl
                head={["Supply", "Spaces"]}
                right={[1]}
                rows={[
                  ["Provided (all levels)", fmt0(parking.availableTotal)],
                  ["Balance", `${parking.grandBalance >= 0 ? "+" : ""}${fmt0(parking.grandBalance)}`],
                ]}
              />
              <Tile
                label="Parking surface needed"
                value={m2(parking.totalParkingSurfaceM2)}
                sub={`${fmt0(parking.grandRequiredWithPOD)} spaces × ${fmt0(parking.m2PerParkingSpaceUsed)} m²/space · basements provide ${fmt0(basementsBUA)} m²`}
              />
            </div>
          </div>
        </Sec>

        {/* ──────────────────── 07 Vertical transportation ───────────────── */}
        <Sec num="07" title="Vertical transportation" breakBefore={false}
          sub="Dubai Building Code D.8.8 lift sizing from the population and floor stack.">
          <div className="grid grid-cols-4 gap-3 mb-4">
            <Tile label="Population" value={fmt0(lifts.totalPopulation)} sub={`${fmt0(lifts.totalUnits)} units`} />
            <Tile label="Occupied floors" value={fmt0(lifts.occupiedFloors)} />
            <Tile label="Boarding floors" value={fmt0(lifts.boardingFloors)} />
            <Tile label="Lifts required" value={lifts.dbcTotal !== null ? fmt0(lifts.liftsRecommended) : "VT study"} accent />
          </div>
          <p className="text-[10px] text-ink-500 leading-snug">
            Governing rule: {lifts.governing}. Minimum passenger lift: {fmt0(lifts.passengerMin.ratedKg)} kg /{" "}
            {lifts.passengerMin.persons} persons, cabin {lifts.passengerMin.cabinW_mm}×{lifts.passengerMin.cabinD_mm} mm
            {lifts.dbcOutOfChart ? " — population/floors beyond the D.8.8 chart; a VT consultant study is required." : "."}
          </p>
        </Sec>

        {/* ──────────────────── 08 Areas & efficiency ────────────────────── */}
        <Sec num="08" title="Areas & efficiency"
          sub="GFA, sellable and construction totals with the arithmetic that builds them, plus the headline ratios.">
          <div className="grid grid-cols-2 gap-6 items-start mb-4">
            <Tbl
              head={["GFA total", "m²"]}
              right={[1]}
              rows={[
                [hospM2 > 0 ? "Residential GFA (incl. hospitality)" : "Residential GFA", fmt0(resGFA)],
                ...(retailM2 > 0 ? [["Retail", fmt0(retailM2)]] : []),
                ...(commercialM2 > 0 ? [["Commercial / office", fmt0(commercialM2)]] : []),
              ] as (string | number)[][]}
              foot={["Σ GFA", fmt0(totalGFA)]}
            />
            <Tbl
              head={["GSA (sellable)", "m²"]}
              right={[1]}
              rows={[
                [`Apartments interior — residential × ${pct(aptPct)}`, fmt0(aptInterior)],
                [`Balconies — × ${pct(balconyShare * 100)} share`, fmt0(balconiesBUA)],
              ]}
              foot={["Σ GSA", fmt0(gsa)]}
            />
          </div>
          <Tbl
            head={["Construction BUA", "m²", "sqft"]}
            right={[1, 2]}
            rows={[
              ["Apartments interior", fmt0(aptInterior), fmt0(aptInterior * M2_TO_SQFT)],
              ["Balconies", fmt0(balconiesBUA), fmt0(balconiesBUA * M2_TO_SQFT)],
              ["Amenities", fmt0(amenitiesBUA), fmt0(amenitiesBUA * M2_TO_SQFT)],
              ["Circulation", fmt0(circulationBUA), fmt0(circulationBUA * M2_TO_SQFT)],
              ["Services (MEP)", fmt0(servicesBUA), fmt0(servicesBUA * M2_TO_SQFT)],
              ["Ground + podium shell", fmt0(groundPodiumBUA), fmt0(groundPodiumBUA * M2_TO_SQFT)],
              ["Basements", fmt0(basementsBUA), fmt0(basementsBUA * M2_TO_SQFT)],
            ]}
            foot={["Σ BUA (construction)", fmt0(constructionBUA), fmt0(constructionBUA * M2_TO_SQFT)]}
          />
          <div className="grid grid-cols-3 gap-3 mt-4">
            {ratios.map(([label, num, den]) => (
              <div key={label} className="border border-qube-600 bg-qube-50 p-3 rpt-avoid-break">
                <div className="text-[8.5px] uppercase tracking-[0.18em] text-qube-800">{label}</div>
                <div className="text-[24px] font-light tabular-nums text-qube-900 mt-0.5">
                  {num > 0 && den > 0 ? pct((num / den) * 100) : "—"}
                </div>
                <div className="text-[9px] text-ink-500 tabular-nums">
                  {num > 0 && den > 0 ? `${fmt0(num)} ÷ ${fmt0(den)} m²` : "needs both totals"}
                </div>
              </div>
            ))}
          </div>
        </Sec>

        {/* footer */}
        <div className="border-t-2 border-ink-900 pt-3 mt-2 flex items-baseline justify-between text-[9px] text-ink-500">
          <span className="uppercase tracking-[0.22em]">QUBE Development · Plot Feasibility</span>
          <span>
            {project.name} — generated{" "}
            {now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{" "}
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · feasibility-level figures, not for construction
          </span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- overlay -------------------------------- */

export default function ReportOverlay({ onClose }: { onClose: () => void }) {
  const project = useProject();

  useEffect(() => {
    document.body.classList.add("report-open");
    const prevTitle = document.title;
    document.title = `${project.name} — Feasibility Report`;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("report-open");
      document.title = prevTitle;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, project.name]);

  // Portaled to <body>: in print media every OTHER body child is display:none,
  // so the printed document is exactly this overlay in normal flow.
  return createPortal(
    <div className="report-overlay fixed inset-0 z-[90] bg-ink-900/80 overflow-y-auto py-8 px-4">
      <div className="report-toolbar sticky top-0 z-10 max-w-[820px] mx-auto flex items-center justify-between gap-3 bg-ink-900 border border-bone-100/20 px-4 py-2.5 mb-4">
        <div className="text-bone-100 text-[12px]">
          <span className="uppercase tracking-[0.18em] text-[10px] text-bone-200/60 mr-3">Report preview</span>
          {project.name}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
            title="Opens the print dialog — choose “Save as PDF”"
          >
            ⬇ Save as PDF
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] border border-bone-100/30 text-bone-100 hover:bg-white/10 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
      <ReportDocument />
    </div>,
    document.body,
  );
}
