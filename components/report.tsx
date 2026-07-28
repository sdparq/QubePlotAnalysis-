"use client";
/**
 * Feasibility report — a compact, print-designed one-pager: project header,
 * areas summary (GFA / GSA / BUA with their derivations) and the efficiency
 * ratios. "Save as PDF" goes through the browser's print engine, so the
 * output is a crisp vector A4 PDF.
 */
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useProject } from "@/lib/store";
import { useZoneLibrary } from "@/lib/use-zone-library";
import { classForZone } from "@/lib/zone-classes";
import { computeProgram } from "@/lib/calc/program";
import { computeTowerYield } from "@/lib/calc/tower-yield";
import {
  hospitalityGFA,
  residentialSubPct,
  residentialSubQuota,
  residentialGFATarget,
} from "@/lib/calc/gfa";
import type { GfaUseCategory } from "@/lib/types";

const M2_TO_SQFT = 10.7639;
const fmt0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");
const fmt1 = (n: number) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString("en-US") : "—");
const m2 = (n: number) => (n > 0 ? `${fmt0(n)} m²` : "—");
const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function Tbl({ head, rows, foot, right = [] }: {
  head: string[];
  rows: (string | number)[][];
  foot?: (string | number)[];
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

function ReportDocument() {
  const project = useProject();
  const { library } = useZoneLibrary();

  const detectedClass = useMemo(() => classForZone(project.zone, library), [project.zone, library]);
  const program = useMemo(() => computeProgram(project), [project]);
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
  const totalGFA = resGFA + retailM2 + commercialM2;

  // Same arithmetic as the Areas Summary tab.
  const aptPct = residentialSubPct(project, "apartments");
  const aptInterior = residentialSubQuota(project, "apartments");
  const amenitiesBUA = residentialSubQuota(project, "amenities");
  const circulationBUA = residentialSubQuota(project, "circulation");
  const servicesBUA = residentialSubQuota(project, "services");
  const balconyShare = program.totalInteriorGFA > 0 ? program.totalBalcony / program.totalInteriorGFA : 0;
  const balconiesBUA = aptInterior * balconyShare;
  const groundPodiumShell = yield_.groundGFA + yield_.podiumGFA;
  const groundPodiumBUA = groundPodiumShell > 0 ? groundPodiumShell : retailM2 + commercialM2;
  const basementCount = project.basements?.count ?? 0;
  const basementFootprint = project.basementFootprintM2 ?? project.plotArea ?? 0;
  const basementsBUA = basementCount * basementFootprint;
  const constructionBUA =
    aptInterior + balconiesBUA + amenitiesBUA + circulationBUA + servicesBUA + groundPodiumBUA + basementsBUA;
  // Retail is sellable stock too — same convention as the Areas Summary tab.
  const gsa = aptInterior + balconiesBUA + retailM2;

  const groundCount = project.ground?.count ?? 1;
  const podiumCount = project.podium?.count ?? 0;
  const towerCount = project.typeFloors?.count ?? project.numFloors;
  const towerHeight = project.typeFloors?.heightM ?? project.floorHeight;
  const totalHeightM =
    groundCount * (project.ground?.heightM ?? 4.5) +
    podiumCount * (project.podium?.heightM ?? 4.0) +
    towerCount * towerHeight;
  const far = project.plotArea > 0 ? totalGFA / project.plotArea : 0;

  const now = new Date();
  const classRow = detectedClass ? library[detectedClass] : null;

  const ratios: [string, number, number, string][] = [
    ["GSA / GFA", gsa, totalGFA, "sellable share of the FAR-counted area"],
    ["GFA / BUA", totalGFA, constructionBUA, "FAR-counted share of everything built"],
    ["GSA / BUA", gsa, constructionBUA, "sellable share of everything built"],
  ];

  return (
    <div id="print-report" className="bg-white text-ink-900 w-[820px] mx-auto shadow-2xl print:shadow-none">
      {/* ─────────────────────────────── Header ────────────────────────────── */}
      <div className="bg-ink-900 text-bone-100 px-10 pt-10 pb-8 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent 96%, #8faa78 96%), linear-gradient(90deg, transparent 96%, #8faa78 96%)",
            backgroundSize: "34px 34px",
          }}
        />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.4em] text-qube-500 mb-6">
            Plot Feasibility · Areas &amp; Ratios
          </div>
          <h1 className="text-[36px] leading-[1.05] font-light tracking-tight mb-3">{project.name}</h1>
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
        <div className="relative grid grid-cols-4 gap-px bg-bone-100/15 border border-bone-100/15 mt-8">
          {[
            ["Plot area", m2(project.plotArea)],
            ["Target GFA", m2(target)],
            ["Units", program.totalUnits > 0 ? fmt0(program.totalUnits) : "—"],
            ["FAR", far > 0 ? far.toFixed(2) : "—"],
            ["Floors above ground", fmt0(groundCount + podiumCount + towerCount)],
            ["Height", totalHeightM > 0 ? `${fmt1(totalHeightM)} m` : "—"],
            ["Sellable (matrix)", program.totalSellable > 0 ? m2(program.totalSellable) : "—"],
            ["Basements", basementCount > 0 ? `${fmt0(basementCount)} × ${fmt0(basementFootprint)} m²` : "—"],
          ].map(([l, v]) => (
            <div key={l} className="bg-ink-900 px-3 py-3">
              <div className="text-[8px] uppercase tracking-[0.18em] text-bone-200/50">{l}</div>
              <div className="text-[16px] font-light tabular-nums text-bone-100 mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-10 py-8">
        {/* ───────────────────────── Areas summary ──────────────────────── */}
        <div className="flex items-baseline gap-3 border-b-2 border-ink-900 pb-2 mb-4">
          <h2 className="text-[19px] font-medium tracking-tight text-ink-900">Areas summary</h2>
        </div>

        <div className="grid grid-cols-2 gap-6 items-start mb-5">
          <Tbl
            head={["GFA total", "m²", "sqft"]}
            right={[1, 2]}
            rows={[
              [hospM2 > 0 ? "Residential (incl. hospitality)" : "Residential", fmt0(resGFA), fmt0(resGFA * M2_TO_SQFT)],
              ...(retailM2 > 0 ? [["Retail", fmt0(retailM2), fmt0(retailM2 * M2_TO_SQFT)]] : []),
              ...(commercialM2 > 0 ? [["Commercial / office", fmt0(commercialM2), fmt0(commercialM2 * M2_TO_SQFT)]] : []),
            ] as (string | number)[][]}
            foot={[
              target > 0 ? `Σ GFA — ${pct((totalGFA / target) * 100)} of target` : "Σ GFA",
              fmt0(totalGFA),
              fmt0(totalGFA * M2_TO_SQFT),
            ]}
          />
          <Tbl
            head={["GSA (sellable)", "m²", "sqft"]}
            right={[1, 2]}
            rows={[
              [`Apartments interior — residential × ${pct(aptPct)}`, fmt0(aptInterior), fmt0(aptInterior * M2_TO_SQFT)],
              [`Balconies — × ${pct(balconyShare * 100)} share`, fmt0(balconiesBUA), fmt0(balconiesBUA * M2_TO_SQFT)],
              ...(retailM2 > 0 ? [["Retail — leasable/sellable", fmt0(retailM2), fmt0(retailM2 * M2_TO_SQFT)]] : []),
            ] as (string | number)[][]}
            foot={["Σ GSA (sellable)", fmt0(gsa), fmt0(gsa * M2_TO_SQFT)]}
          />
        </div>

        <Tbl
          head={["Construction BUA", "m²", "sqft"]}
          right={[1, 2]}
          rows={[[
            "Apartments + balconies + amenities + circulation + services + ground/podium shell + basements",
            fmt0(constructionBUA),
            fmt0(constructionBUA * M2_TO_SQFT),
          ]]}
          foot={["Σ BUA (construction)", fmt0(constructionBUA), fmt0(constructionBUA * M2_TO_SQFT)]}
        />

        {/* ─────────────────────────── Ratios ───────────────────────────── */}
        <div className="flex items-baseline gap-3 border-b-2 border-ink-900 pb-2 mb-4 mt-8">
          <h2 className="text-[19px] font-medium tracking-tight text-ink-900">Efficiency ratios</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {ratios.map(([label, num, den, hint]) => (
            <div key={label} className="border border-qube-600 bg-qube-50 p-4 rpt-avoid-break">
              <div className="text-[8.5px] uppercase tracking-[0.18em] text-qube-800">{label}</div>
              <div className="text-[28px] font-light tabular-nums text-qube-900 mt-1">
                {num > 0 && den > 0 ? pct((num / den) * 100) : "—"}
              </div>
              <div className="text-[9px] text-ink-500 tabular-nums mt-0.5">
                {num > 0 && den > 0 ? `${fmt0(num)} ÷ ${fmt0(den)} m²` : "needs both totals"}
              </div>
              <div className="text-[9px] text-ink-400 mt-1.5 leading-snug">{hint}</div>
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="border-t-2 border-ink-900 pt-3 mt-10 flex items-baseline justify-between text-[9px] text-ink-500">
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
