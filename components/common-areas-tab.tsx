"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt0 } from "@/lib/format";
import {
  residentialBUA,
  residentialSubQuota,
} from "@/lib/calc/gfa";
import {
  defaultCommonAreasBreakdown,
  DEFAULT_RESIDENTIAL_BREAKDOWN,
  type CommonArea,
  type CommonAreaSub,
  type CommonAreasBreakdown,
  type CommonAreasGroup,
} from "@/lib/types";

const M2_TO_SQFT = 10.7639;
function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  return `${Math.round(m2 * M2_TO_SQFT).toLocaleString("en-US")} sqft`;
}

interface GroupDef {
  key: CommonAreasGroup;
  label: string;
  hint: string;
}

const GROUPS: GroupDef[] = [
  { key: "amenities",   label: "Amenities",   hint: "Indoor + outdoor amenity rooms (gym, pool, sauna, kids, coworking…)." },
  { key: "circulation", label: "Circulation", hint: "Lobbies and corridors." },
  { key: "services",    label: "Services",    hint: "MEP rooms, shafts, ducts, plant rooms." },
];

/** Build the flat CommonArea[] list the rest of the calc engine consumes.
 *  Each sub's m² is `groupGFAQuota × sub.pct / 100`. GFA-counted subs together
 *  cover the group's GFA quota; non-GFA subs are additive BUA extras. */
function buildFlatCommonAreas(
  breakdown: CommonAreasBreakdown,
  groupGFAQuota: Record<CommonAreasGroup, number>,
): CommonArea[] {
  const out: CommonArea[] = [];
  for (const g of GROUPS) {
    const quota = groupGFAQuota[g.key];
    for (const sub of breakdown[g.key]) {
      const area = (quota * sub.pct) / 100;
      out.push({
        id: sub.id,
        name: `${g.label} · ${sub.name}`,
        area: Number(area.toFixed(2)),
        floors: 1,
        category: sub.countsAsGFA ? "GFA" : "OPEN",
      });
    }
  }
  return out;
}

export default function CommonAreasTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);

  const breakdown: CommonAreasBreakdown = useMemo(
    () => project.commonAreasBreakdown ?? defaultCommonAreasBreakdown(),
    [project.commonAreasBreakdown],
  );

  // Group GFA quota = (group % of residential) × residentialGFA — exact, no
  // capping. Apartments auto-derives as 100% − Σ groups inside residentialSubQuota
  // so the four shares always sum to 100%.
  function groupGFAQuotaFor(rbOverride?: typeof DEFAULT_RESIDENTIAL_BREAKDOWN): Record<CommonAreasGroup, number> {
    const proj = rbOverride ? { ...project, residentialBreakdown: rbOverride } : project;
    return {
      amenities:   residentialSubQuota(proj, "amenities"),
      circulation: residentialSubQuota(proj, "circulation"),
      services:    residentialSubQuota(proj, "services"),
    };
  }
  const groupGFAQuota = groupGFAQuotaFor();

  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  const groupPct: Record<CommonAreasGroup, number> = {
    amenities:   rb.amenities?.pct   ?? 0,
    circulation: rb.circulation?.pct ?? 0,
    services:    rb.services?.pct    ?? 0,
  };
  const residentialBUATotal = useMemo(() => residentialBUA(project), [project]);

  function commit(next: CommonAreasBreakdown) {
    patch({
      commonAreasBreakdown: next,
      commonAreas: buildFlatCommonAreas(next, groupGFAQuota),
    });
  }

  function updateSub(group: CommonAreasGroup, id: string, partial: Partial<CommonAreaSub>) {
    const nextGroup = breakdown[group].map((s) => (s.id === id ? { ...s, ...partial } : s));
    commit({ ...breakdown, [group]: nextGroup });
  }

  function deleteSub(group: CommonAreasGroup, id: string) {
    const nextGroup = breakdown[group].filter((s) => s.id !== id);
    commit({ ...breakdown, [group]: nextGroup });
  }

  function addSub(group: CommonAreasGroup) {
    const newSub: CommonAreaSub = {
      id: `ca-${group}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: "New",
      pct: 0,
      countsAsGFA: true,
    };
    commit({ ...breakdown, [group]: [...breakdown[group], newSub] });
  }

  /** Rebalance only the GFA-counted rows so their pcts sum to 100%. Non-GFA
   *  rows are intentionally left alone — they're additive BUA extras and the
   *  user controls them independently. */
  function rebalanceGroup(group: CommonAreasGroup) {
    const subs = breakdown[group];
    const gfaSum = subs.filter((s) => s.countsAsGFA).reduce((s, x) => s + x.pct, 0);
    if (gfaSum <= 0) return;
    const factor = 100 / gfaSum;
    const nextGroup = subs.map((s) =>
      s.countsAsGFA ? { ...s, pct: Number((s.pct * factor).toFixed(2)) } : s,
    );
    commit({ ...breakdown, [group]: nextGroup });
  }

  function updateGroupResidentialPct(group: CommonAreasGroup, pct: number) {
    const curRb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
    const nextRb = { ...curRb, [group]: { ...curRb[group], pct: Math.max(0, pct) } };
    const nextQuotas = groupGFAQuotaFor(nextRb);
    patch({
      residentialBreakdown: nextRb,
      commonAreas: buildFlatCommonAreas(breakdown, nextQuotas),
    });
  }

  // ── Aggregate stats (derived live from the breakdown to stay in sync) ──
  const aggregated = (["amenities", "circulation", "services"] as CommonAreasGroup[])
    .flatMap((g) =>
      breakdown[g].map((s) => {
        const m2 = (groupGFAQuota[g] * s.pct) / 100;
        return {
          bua: m2,
          gfa: s.countsAsGFA ? m2 : 0,
          open: s.countsAsGFA ? 0 : m2,
        };
      }),
    );
  const totalBUA = aggregated.reduce((s, x) => s + x.bua, 0);
  const totalGFA = aggregated.reduce((s, x) => s + x.gfa, 0);
  const totalOpen = aggregated.reduce((s, x) => s + x.open, 0);

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Common Areas &amp; Services</h2>
          <p className="section-sub">
            Cada grupo (Amenities, Circulation, Services) tiene un <strong>% de residential</strong>{" "}
            editable que fija su cuota de GFA. Dentro de cada grupo, las subcategorías reparten esa
            cuota — las marcadas <strong>GFA</strong> deben sumar 100% para cubrir la cuota; las
            <strong> Non-GFA</strong> son metros cuadrados extra que sólo cuentan como BUA.
          </p>
        </div>

        {residentialBUATotal <= 0 && (
          <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12.5px] mb-4 leading-snug">
            Set <strong>Residential GFA</strong> in Setup&apos;s GFA breakdown to drive
            this table.
          </div>
        )}

        {residentialBUATotal > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Total common areas BUA" value={`${fmt0(totalBUA)} m²`} sub={fmtSqft(totalBUA)} />
            <Stat label="Counted as GFA" value={`${fmt0(totalGFA)} m²`} sub={fmtSqft(totalGFA)} />
            <Stat label="Non-GFA (extra BUA)" value={`${fmt0(totalOpen)} m²`} sub={fmtSqft(totalOpen)} />
            <Stat label="Σ Group GFA quota" value={`${fmt0(groupGFAQuota.amenities + groupGFAQuota.circulation + groupGFAQuota.services)} m²`} />
          </div>
        )}

        <div className="grid gap-5">
          {GROUPS.map((g) => (
            <GroupSection
              key={g.key}
              group={g}
              subs={breakdown[g.key]}
              groupGFAQuota={groupGFAQuota[g.key]}
              groupPct={groupPct[g.key]}
              onAdd={() => addSub(g.key)}
              onRebalance={() => rebalanceGroup(g.key)}
              onUpdateSub={(id, partial) => updateSub(g.key, id, partial)}
              onDelete={(id) => deleteSub(g.key, id)}
              onUpdateGroupPct={(pct) => updateGroupResidentialPct(g.key, pct)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Group section                                 */
/* -------------------------------------------------------------------------- */

function GroupSection({
  group, subs, groupGFAQuota, groupPct, onAdd, onRebalance, onUpdateSub, onDelete, onUpdateGroupPct,
}: {
  group: GroupDef;
  subs: CommonAreaSub[];
  groupGFAQuota: number;
  groupPct: number;
  onAdd: () => void;
  onRebalance: () => void;
  onUpdateSub: (id: string, partial: Partial<CommonAreaSub>) => void;
  onDelete: (id: string) => void;
  onUpdateGroupPct: (pct: number) => void;
}) {
  const gfaPctSum = subs.filter((s) => s.countsAsGFA).reduce((s, x) => s + x.pct, 0);
  const allPctSum = subs.reduce((s, x) => s + x.pct, 0);
  const gfaMismatch = subs.some((s) => s.countsAsGFA) && Math.abs(gfaPctSum - 100) > 0.5;
  const gfaTotalM2 = (groupGFAQuota * gfaPctSum) / 100;
  const buaTotalM2 = (groupGFAQuota * allPctSum) / 100;

  return (
    <div className="border border-ink-200">
      {/* Group header */}
      <div className="grid grid-cols-[1fr_120px_120px_140px] gap-2 items-baseline px-3 py-2 bg-bone-50 border-b border-ink-200">
        <div>
          <div className="text-[14px] font-medium text-ink-900">{group.label}</div>
          <div className="text-[10.5px] text-ink-500 leading-snug">{group.hint}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">% of residential</div>
          <div className="relative inline-block">
            <input
              type="number"
              step={0.5}
              min={0}
              className="cell-input text-right pr-5 !py-1 !px-1.5 w-[80px]"
              value={Number(groupPct.toFixed(2))}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n >= 0) onUpdateGroupPct(n);
              }}
            />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9.5px] text-ink-400 pointer-events-none">%</span>
          </div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">GFA quota</div>
          <div className="text-[12px] text-ink-900 tabular-nums">
            {groupGFAQuota > 0 ? `${Math.round(groupGFAQuota).toLocaleString("en-US")} m²` : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">Actual GFA / BUA</div>
          <div className="text-[12px] text-qube-800 font-medium tabular-nums">
            {gfaTotalM2 > 0 ? `${Math.round(gfaTotalM2).toLocaleString("en-US")} m²` : "—"}
            <span className="text-ink-500 font-normal">
              {" "}/ {buaTotalM2 > 0 ? `${Math.round(buaTotalM2).toLocaleString("en-US")} m²` : "—"}
            </span>
          </div>
          {gfaMismatch && (
            <div className="text-[10px] text-amber-700 mt-0.5">
              GFA subs Σ {gfaPctSum.toFixed(1)}% (target 100%)
            </div>
          )}
        </div>
      </div>

      {/* Sub-rows table */}
      <div className="grid grid-cols-[14px_1fr_90px_100px_110px_120px_28px] gap-1 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 border-b border-ink-100 bg-bone-50/40">
        <span></span>
        <span>Subcategory</span>
        <span className="text-right">% of group</span>
        <span className="text-center">Counts as</span>
        <span className="text-right">m²</span>
        <span className="text-right">≈ sqft</span>
        <span></span>
      </div>
      {subs.map((sub) => {
        const m2 = (groupGFAQuota * sub.pct) / 100;
        return (
          <div
            key={sub.id}
            className="grid grid-cols-[14px_1fr_90px_100px_110px_120px_28px] gap-1 px-3 py-1.5 items-center text-[12px] tabular-nums border-b border-ink-100"
          >
            <span className="text-ink-300 text-[14px] leading-none">└</span>
            <input
              className="cell-input !py-1 !px-1.5"
              value={sub.name}
              onChange={(e) => onUpdateSub(sub.id, { name: e.target.value })}
            />
            <div className="relative">
              <input
                type="number"
                step={0.5}
                min={0}
                className="cell-input text-right pr-6 !py-1 !px-1.5"
                value={Number(sub.pct.toFixed(2))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) onUpdateSub(sub.id, { pct: n });
                }}
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9.5px] text-ink-400 pointer-events-none">%</span>
            </div>
            <div className="text-center">
              <button
                onClick={() => onUpdateSub(sub.id, { countsAsGFA: !sub.countsAsGFA })}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] border ${
                  sub.countsAsGFA
                    ? "bg-qube-500 text-white border-qube-500"
                    : "bg-white text-ink-500 border-ink-300"
                }`}
              >{sub.countsAsGFA ? "GFA" : "Non-GFA"}</button>
            </div>
            <div className="text-right text-ink-900">{m2 > 0 ? Math.round(m2).toLocaleString("en-US") : "—"}</div>
            <div className="text-right text-ink-500">{fmtSqft(m2)}</div>
            <button
              onClick={() => onDelete(sub.id)}
              className="text-ink-400 hover:text-red-700 text-[14px] leading-none justify-self-center"
              title="Delete this subcategory"
              aria-label="Delete"
            >×</button>
          </div>
        );
      })}

      {/* Footer: sums + actions */}
      <div className="grid grid-cols-[14px_1fr_90px_100px_110px_120px_28px] gap-1 px-3 py-1.5 items-center text-[11.5px] tabular-nums bg-bone-50/40">
        <span></span>
        <span className="uppercase tracking-[0.08em] text-[10.5px] text-ink-500">Σ GFA / Σ total</span>
        <span className={`text-right ${gfaMismatch ? "text-amber-700 font-medium" : "text-ink-700"}`}>
          {gfaPctSum.toFixed(1)}% / {allPctSum.toFixed(1)}%
        </span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-ink-100">
        <button onClick={onAdd} className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline">
          + Add subcategory
        </button>
        {gfaMismatch && (
          <button
            onClick={onRebalance}
            className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
            title="Scale only the GFA-counted rows so they sum to 100%"
          >Rebalance GFA rows to 100%</button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className="text-[18px] font-light text-ink-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
