"use client";
import { useMemo } from "react";
import { useProject } from "@/lib/store";
import {
  residentialBUA,
  residentialSubBUA,
  residentialSubGFA,
  residentialGFATarget,
  effectiveTargetGFA,
  RESIDENTIAL_SUBS,
} from "@/lib/calc/gfa";
import {
  defaultCommonAreasBreakdown,
  type CommonAreasBreakdown,
  type CommonAreasGroup,
  type GfaUseCategory,
  type ResidentialSubCategory,
} from "@/lib/types";

const M2_TO_SQFT = 10.7639;
function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  return `${Math.round(m2 * M2_TO_SQFT).toLocaleString("en-US")} sqft`;
}
function fmtM2(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  return `${Math.round(m2).toLocaleString("en-US")} m²`;
}

const GROUP_LABEL: Record<CommonAreasGroup, string> = {
  amenities: "Amenities",
  circulation: "Circulation",
  services: "Services",
};

const RESIDENTIAL_SUB_LABEL: Record<ResidentialSubCategory, string> = {
  apartments: "Apartments",
  amenities: "Amenities",
  circulation: "Circulation",
  services: "Services",
};

const OTHER_USES: { key: GfaUseCategory; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "commercial", label: "Commercial / Office" },
  { key: "hospitality", label: "Hospitality" },
];

export default function SummaryTab() {
  const project = useProject();

  const target = effectiveTargetGFA(project);
  const maxBUA = project.maxBUA ?? 0;
  const cab: CommonAreasBreakdown = useMemo(
    () => project.commonAreasBreakdown ?? defaultCommonAreasBreakdown(),
    [project.commonAreasBreakdown],
  );

  // ── Residential breakdown ───────────────────────────────────────────────
  const residentialBuaTotal = useMemo(() => residentialBUA(project), [project]);
  const residentialGfaTotal = useMemo(() => residentialGFATarget(project), [project]);

  // ── Other uses (no sub-breakdown today → BUA = GFA) ─────────────────────
  function useM2(key: GfaUseCategory): number {
    const item = project.gfaBreakdown?.[key];
    if (!item) return 0;
    return item.mode === "absolute" ? item.value : (item.value / 100) * target;
  }
  const otherUses = OTHER_USES.map((u) => ({ ...u, gfa: useM2(u.key) }))
    .filter((u) => u.gfa > 0);

  const totalGFA = residentialGfaTotal + otherUses.reduce((s, u) => s + u.gfa, 0);
  const totalBUA = residentialBuaTotal + otherUses.reduce((s, u) => s + u.gfa, 0);

  const gfaOverTarget = target > 0 && totalGFA > target + 1;
  const buaOverMax = maxBUA > 0 && totalBUA > maxBUA + 1;

  // ── Build the table rows ────────────────────────────────────────────────
  type Row =
    | { type: "category"; label: string; bua: number; gfa: number }
    | { type: "sub1"; label: string; bua: number; gfa: number; flag: string }
    | { type: "sub2"; label: string; bua: number; gfa: number; flag: string }
    | { type: "total"; label: string; bua: number; gfa: number };

  const rows: Row[] = [];

  if (residentialBuaTotal > 0) {
    rows.push({
      type: "category",
      label: "Residential",
      bua: residentialBuaTotal,
      gfa: residentialGfaTotal,
    });
    for (const sub of RESIDENTIAL_SUBS) {
      const subBUA = residentialSubBUA(project, sub);
      const subGFA = residentialSubGFA(project, sub);
      if (subBUA <= 0) continue;
      const flag = subGFA > 0 ? "GFA" : "Non-GFA";
      rows.push({
        type: "sub1",
        label: RESIDENTIAL_SUB_LABEL[sub],
        bua: subBUA,
        gfa: subGFA,
        flag,
      });
      if (sub === "apartments") continue;
      const subs = cab[sub as CommonAreasGroup];
      for (const item of subs) {
        const itemBUA = subBUA * item.pct / 100;
        if (itemBUA <= 0) continue;
        rows.push({
          type: "sub2",
          label: item.name,
          bua: itemBUA,
          gfa: item.countsAsGFA ? itemBUA : 0,
          flag: item.countsAsGFA ? "GFA" : "Non-GFA",
        });
      }
    }
  }

  for (const u of otherUses) {
    rows.push({
      type: "category",
      label: u.label,
      bua: u.gfa,
      gfa: u.gfa,
    });
  }

  rows.push({ type: "total", label: "TOTAL", bua: totalBUA, gfa: totalGFA });

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="section-title">Areas summary</h2>
            <p className="section-sub">
              Project-wide BUA and GFA breakdown by category and subcategory. Every number is
              live-computed from Setup → GFA breakdown, Residential composition and Common
              Areas sub-breakdown.
            </p>
          </div>
        </div>

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Stat label="Target GFA" value={target > 0 ? fmtM2(target) : "—"} sub={fmtSqft(target)} />
          <Stat label="Max BUA" value={maxBUA > 0 ? fmtM2(maxBUA) : "—"} sub={maxBUA > 0 ? fmtSqft(maxBUA) : "Not set"} />
          <Stat
            label="Σ Project GFA"
            value={fmtM2(totalGFA)}
            sub={fmtSqft(totalGFA)}
            good={target > 0 && Math.abs(totalGFA - target) < 1}
            bad={gfaOverTarget}
          />
          <Stat
            label="Σ Project BUA"
            value={fmtM2(totalBUA)}
            sub={fmtSqft(totalBUA)}
            bad={buaOverMax}
          />
        </div>

        {/* Warnings */}
        {gfaOverTarget && (
          <p className="text-[11.5px] text-amber-900 mb-3 leading-snug">
            Σ Project GFA = {fmtM2(totalGFA)} exceeds the Target GFA of {fmtM2(target)} by{" "}
            <strong>{fmtM2(totalGFA - target)}</strong>. Reduce a use allocation or rebalance
            in <em>Setup → GFA breakdown</em>.
          </p>
        )}
        {buaOverMax && (
          <p className="text-[11.5px] text-red-700 mb-3 leading-snug">
            Σ Project BUA = {fmtM2(totalBUA)} exceeds the <strong>Max BUA</strong> of{" "}
            {fmtM2(maxBUA)} by <strong>{fmtM2(totalBUA - maxBUA)}</strong>. Reduce Non-GFA
            subcategories or relax the limit in Setup.
          </p>
        )}

        {/* Main breakdown table */}
        <div className="border border-ink-200 overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <colgroup>
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <thead>
              <tr className="bg-bone-50 border-b border-ink-200 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">
                <th className="text-left px-3 py-2 font-medium">Category / Subcategory</th>
                <th className="text-right px-2 py-2 font-medium">BUA m²</th>
                <th className="text-right px-2 py-2 font-medium">GFA m²</th>
                <th className="text-right px-2 py-2 font-medium">BUA sqft</th>
                <th className="text-right px-2 py-2 font-medium">GFA sqft</th>
                <th className="text-center px-2 py-2 font-medium">Counts as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isCategory = r.type === "category";
                const isTotal = r.type === "total";
                const indent =
                  r.type === "sub1" ? "pl-8" :
                  r.type === "sub2" ? "pl-14" :
                  "pl-3";
                const cls =
                  isTotal
                    ? "bg-qube-50 font-medium text-qube-800 border-t-2 border-qube-200"
                    : isCategory
                      ? "bg-bone-50/60 font-medium text-ink-900 border-t border-ink-200"
                      : r.type === "sub1"
                        ? "border-t border-ink-100 text-ink-900"
                        : "border-t border-ink-100 text-ink-700";
                return (
                  <tr key={`${r.type}-${r.label}-${i}`} className={cls}>
                    <td className={`${indent} py-1.5 pr-2`}>
                      {r.type === "sub1" && <span className="text-ink-300 mr-1">└</span>}
                      {r.type === "sub2" && <span className="text-ink-300 mr-1">└</span>}
                      {r.label}
                    </td>
                    <td className="text-right px-2 py-1.5">
                      {r.bua > 0 ? Math.round(r.bua).toLocaleString("en-US") : "—"}
                    </td>
                    <td className={`text-right px-2 py-1.5 ${isCategory || isTotal ? "" : "text-qube-800 font-medium"}`}>
                      {r.gfa > 0 ? Math.round(r.gfa).toLocaleString("en-US") : "—"}
                    </td>
                    <td className="text-right px-2 py-1.5 text-ink-500">
                      {r.bua > 0 ? `${Math.round(r.bua * M2_TO_SQFT).toLocaleString("en-US")}` : "—"}
                    </td>
                    <td className="text-right px-2 py-1.5 text-ink-500">
                      {r.gfa > 0 ? `${Math.round(r.gfa * M2_TO_SQFT).toLocaleString("en-US")}` : "—"}
                    </td>
                    <td className="text-center px-2 py-1.5">
                      {("flag" in r) && (
                        <span
                          className={`px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.10em] border ${
                            r.flag === "GFA"
                              ? "bg-qube-100 text-qube-800 border-qube-200"
                              : "bg-bone-100 text-ink-500 border-ink-200"
                          }`}
                        >{r.flag}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10.5px] text-ink-500 mt-3 leading-snug">
          BUA = Built-Up Area (total constructed area). GFA = Gross Floor Area (BUA counted
          toward FAR). The breakdown reflects the residential GFA target from Setup. Non-GFA
          subcategories inflate the BUA above the GFA target but don&apos;t count toward the
          project&apos;s FAR.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, good, bad,
}: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : good ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className={`text-[18px] font-light tabular-nums mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
