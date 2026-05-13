"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt2, fmtPct } from "@/lib/format";
import { computeProgram } from "@/lib/calc/program";
import {
  commonAreaCategory,
  effectiveCommonAreaTotal,
  DEFAULT_RESIDENTIAL_BREAKDOWN,
  type CommonArea,
  type CommonAreaCategory,
} from "@/lib/types";
import {
  DEFAULT_AMENITIES_SUBS,
  DEFAULT_CIRCULATION_SUBS,
  DEFAULT_SERVICES_SUBS,
  generateRowsFromSubs,
} from "@/lib/common-areas-defaults";

/** Mirror the Program tab calc — total residential built area derived from the
 *  Setup GFA breakdown (Residential GFA / sum-of-GFA-counted shares). */
function computeResidentialBUA(project: ReturnType<typeof useProject>): number {
  const item = project.gfaBreakdown?.residential;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  const residentialGFA = item.mode === "absolute" ? item.value : (item.value / 100) * target;
  if (residentialGFA <= 0) return 0;
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  let gfaShare = 0;
  for (const v of Object.values(rb)) {
    if (v.countsAsGFA) gfaShare += v.pct;
  }
  gfaShare /= 100;
  return gfaShare > 0 ? residentialGFA / gfaShare : residentialGFA;
}

export default function CommonAreasTab() {
  const project = useProject();
  const upsert = useStore((s) => s.upsertCommonArea);
  const remove = useStore((s) => s.removeCommonArea);
  const patch = useStore((s) => s.patch);
  const program = computeProgram(project);

  const isPctMode = project.commonAreasInputMode === "percentage";
  const targetGFA = project.targetGFA ?? 0;

  // ── Setup-driven group totals ───────────────────────────────────────────
  const residentialBUA = useMemo(() => computeResidentialBUA(project), [project]);
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  const amenitiesBUA   = residentialBUA * (rb.amenities?.pct ?? 0) / 100;
  const circulationBUA = residentialBUA * (rb.circulation?.pct ?? 0) / 100;
  const servicesBUA    = residentialBUA * (rb.services?.pct ?? 0) / 100;

  function generateFromSetup() {
    if (residentialBUA <= 0) {
      alert("Set the Residential GFA in Setup first (GFA breakdown → Residential).");
      return;
    }
    if (project.commonAreas.length > 0) {
      const ok = confirm(
        `Replace the existing ${project.commonAreas.length} common-area row(s) with auto-generated rows from Setup?\n\n` +
        `Amenities ${Math.round(amenitiesBUA).toLocaleString("en-US")} m² · Circulation ${Math.round(circulationBUA).toLocaleString("en-US")} m² · Services ${Math.round(servicesBUA).toLocaleString("en-US")} m²`,
      );
      if (!ok) return;
      for (const c of [...project.commonAreas]) remove(c.id);
    }
    const wasPctMode = isPctMode;
    if (wasPctMode) {
      // Switch to absolute so the m² values land in the same scale as user input.
      patch({ commonAreasInputMode: "absolute" });
    }
    const rows = [
      ...generateRowsFromSubs("Amenities",   amenitiesBUA,   DEFAULT_AMENITIES_SUBS),
      ...generateRowsFromSubs("Circulation", circulationBUA, DEFAULT_CIRCULATION_SUBS),
      ...generateRowsFromSubs("Services",    servicesBUA,    DEFAULT_SERVICES_SUBS),
    ];
    for (const r of rows) upsert(r);
  }

  function addNew() {
    upsert({
      id: `ca-${Date.now()}`,
      name: "New element",
      area: 0,
      floors: 1,
      category: "GFA",
    });
  }
  function update(c: CommonArea, p: Partial<CommonArea>) {
    upsert({ ...c, ...p });
  }

  function switchToPercentage() {
    if (targetGFA <= 0) {
      alert("Set a Target GFA in Setup before switching to percentage mode.");
      return;
    }
    // Convert each row: area now stores a fraction of targetGFA. floors collapses to 1.
    const next = project.commonAreas.map((c) => {
      const totalAbs = (c.area || 0) * (c.floors || 1);
      const pct = totalAbs / targetGFA;
      return { ...c, area: Number(pct.toFixed(6)), floors: 1 };
    });
    for (const c of next) upsert(c);
    patch({ commonAreasInputMode: "percentage" });
  }

  function switchToAbsolute() {
    const target = targetGFA > 0 ? targetGFA : 1;
    const next = project.commonAreas.map((c) => {
      const m2 = (c.area || 0) * target;
      return { ...c, area: Number(m2.toFixed(2)) };
    });
    for (const c of next) upsert(c);
    patch({ commonAreasInputMode: "absolute" });
  }

  const totalGFA = program.commonAreasGFA;
  const totalBUAonly = program.commonAreasBUAonly;
  const totalOpen = program.commonAreasOpen;
  const buaTotal = program.totalBUABuilding;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Common Areas & Services</h2>
            <p className="section-sub">
              Lobbies, corridors, lifts, MEP, amenities. <strong>GFA</strong> counts towards FAR; <strong>BUA</strong>-only is
              built area not in FAR (shafts, lifts, stairs, MEP, basement parking); <strong>Open</strong> for rooftop / open-air.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="grid gap-1">
              <span className="eyebrow text-ink-500 text-[10.5px]">Shafts per unit (m²)</span>
              <input
                type="number"
                step={0.1}
                min={0}
                className="cell-input text-right w-24"
                value={Number(project.shaftPerUnit.toFixed(2))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) patch({ shaftPerUnit: n });
                }}
                title="Average BUA-only shaft area per residential unit (deducted from interior GFA)"
              />
            </label>
            <div className="inline-flex border border-ink-200 bg-bone-50">
              <button
                onClick={() => !isPctMode || switchToAbsolute()}
                className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                  !isPctMode ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
                }`}
              >Area · m²</button>
              <button
                onClick={() => isPctMode || switchToPercentage()}
                className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                  isPctMode ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
                }`}
              >% of GFA</button>
            </div>
            <button
              className="btn btn-secondary"
              onClick={generateFromSetup}
              disabled={residentialBUA <= 0}
              title={
                residentialBUA <= 0
                  ? "Set Residential GFA in Setup first"
                  : `Auto-generate rows from Setup's residential breakdown · ${Math.round(amenitiesBUA + circulationBUA + servicesBUA).toLocaleString("en-US")} m² total`
              }
            >Generate from Setup</button>
            <button className="btn btn-primary" onClick={addNew}>+ Add element</button>
          </div>
        </div>

        {residentialBUA > 0 && (
          <p className="text-[11px] text-ink-500 leading-snug -mt-3 mb-4">
            Driven by Setup: Amenities <strong className="text-ink-900">{Math.round(amenitiesBUA).toLocaleString("en-US")} m²</strong>{" "}
            ({(rb.amenities?.pct ?? 0).toFixed(1)}% of residential) ·
            Circulation <strong className="text-ink-900">{Math.round(circulationBUA).toLocaleString("en-US")} m²</strong>{" "}
            ({(rb.circulation?.pct ?? 0).toFixed(1)}%) ·
            Services <strong className="text-ink-900">{Math.round(servicesBUA).toLocaleString("en-US")} m²</strong>{" "}
            ({(rb.services?.pct ?? 0).toFixed(1)}%). Click <em>Generate from Setup</em> to
            populate the table with default subcategories (Gym · Pool · Sauna · Padel · Social · Kids · Coworking · Lobbies · Corridors · Lift cores · Stairs · MEP · Shafts · Ducts · Plant rooms).
          </p>
        )}

        {isPctMode && targetGFA <= 0 && (
          <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm mb-4">
            Set a <strong>Target GFA</strong> in Setup to drive the percentage mode (computed m² values use that reference).
          </div>
        )}

        {isPctMode && targetGFA > 0 && (
          <div className="text-[11px] text-ink-500 mb-3">
            Reference Target GFA: <strong className="text-ink-900 tabular-nums">{fmt2(targetGFA)} m²</strong> · 100% = {fmt2(targetGFA)} m²
          </div>
        )}

        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: 110 }} />
              {!isPctMode && <col style={{ width: 60 }} />}
              <col style={{ width: 100 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
              <col />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Element</th>
                <th className="text-right">{isPctMode ? "% of GFA" : "Area (m²)"}</th>
                {!isPctMode && <th className="text-right">Floors</th>}
                <th className="text-right">Total (m²)</th>
                <th>Category</th>
                <th className="text-right">% BUA</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.commonAreas.map((c) => {
                const total = effectiveCommonAreaTotal(c, project);
                const cat = commonAreaCategory(c);
                const pctOfBUA = cat === "OPEN" || buaTotal === 0 ? 0 : total / buaTotal;
                return (
                  <tr key={c.id}>
                    <td className="cell-edit">
                      <input className="cell-input" value={c.name} onChange={(e) => update(c, { name: e.target.value })} />
                    </td>
                    <td className="cell-edit">
                      {isPctMode ? (
                        <div className="relative">
                          <input
                            type="number"
                            step={0.05}
                            min={0}
                            className="cell-input text-right pr-6"
                            value={Number(((c.area || 0) * 100).toFixed(3))}
                            onChange={(e) => {
                              const pct = parseFloat(e.target.value) || 0;
                              update(c, { area: pct / 100 });
                            }}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-400">%</span>
                        </div>
                      ) : (
                        <input
                          type="number"
                          step={0.01}
                          className="cell-input text-right"
                          value={c.area}
                          onChange={(e) => update(c, { area: parseFloat(e.target.value) || 0 })}
                        />
                      )}
                    </td>
                    {!isPctMode && (
                      <td className="cell-edit">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="cell-input text-right"
                          value={c.floors}
                          onChange={(e) => update(c, { floors: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })}
                        />
                      </td>
                    )}
                    <td className="text-right text-ink-700 tabular-nums">{fmt2(total)}</td>
                    <td className="cell-edit">
                      <select
                        className="cell-input"
                        value={cat}
                        onChange={(e) => update(c, { category: e.target.value as CommonAreaCategory, countAsGFA: undefined })}
                      >
                        <option value="GFA">GFA</option>
                        <option value="BUA">BUA</option>
                        <option value="OPEN">Open</option>
                      </select>
                    </td>
                    <td className="text-right text-ink-700 tabular-nums">
                      {cat === "OPEN" ? "—" : fmtPct(pctOfBUA, 2)}
                    </td>
                    <td className="cell-edit">
                      <input className="cell-input" value={c.notes ?? ""} onChange={(e) => update(c, { notes: e.target.value })} />
                    </td>
                    <td className="text-right">
                      <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove(c.id); }}>×</button>
                    </td>
                  </tr>
                );
              })}
              <SubtotalRow label="GFA" value={totalGFA} isPctMode={isPctMode} />
              <SubtotalRow label="BUA only" value={totalBUAonly} isPctMode={isPctMode} />
              <SubtotalRow label="Open air" value={totalOpen} isPctMode={isPctMode} />
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Total GFA" value={`${fmt2(program.totalGFABuilding)} m²`} sub={`FAR ${program.far.toFixed(2)}`} />
          <Kpi label="Total BUA" value={`${fmt2(program.totalBUABuilding)} m²`} sub="GFA + balconies + BUA-only commons" />
          <Kpi label="GFA / BUA" value={fmtPct(program.totalGFABuilding / (program.totalBUABuilding || 1), 1)} sub="Net efficiency" />
          <Kpi label="Open-air (non-built)" value={`${fmt2(totalOpen)} m²`} sub="Excluded from BUA" />
        </div>
      </div>
    </div>
  );
}

function SubtotalRow({ label, value, isPctMode }: { label: string; value: number; isPctMode: boolean }) {
  const colSpan = isPctMode ? 2 : 3;
  return (
    <tr className="row-subtotal">
      <td colSpan={colSpan} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal · {label}</td>
      <td className="text-right">{fmt2(value)}</td>
      <td colSpan={4}></td>
    </tr>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}
