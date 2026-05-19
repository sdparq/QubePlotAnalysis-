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
 *  Every row here is GFA — non-GFA built area lives in a separate block. */
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
        category: "GFA",
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

  /** Rebalance all sub rows so their pcts sum to 100% — every row counts as GFA. */
  function rebalanceGroup(group: CommonAreasGroup) {
    const subs = breakdown[group];
    const sum = subs.reduce((s, x) => s + x.pct, 0);
    if (sum <= 0) return;
    const factor = 100 / sum;
    const nextGroup = subs.map((s) => ({ ...s, pct: Number((s.pct * factor).toFixed(2)) }));
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
  const totalGFA = (["amenities", "circulation", "services"] as CommonAreasGroup[])
    .reduce(
      (sum, g) => sum + breakdown[g].reduce((s, row) => s + (groupGFAQuota[g] * row.pct) / 100, 0),
      0,
    );
  const totalQuota = groupGFAQuota.amenities + groupGFAQuota.circulation + groupGFAQuota.services;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Common Areas &amp; Services</h2>
          <p className="section-sub">
            Cada grupo (Amenities, Circulation, Services) tiene un <strong>% de residential GFA</strong>{" "}
            editable que fija su cuota. Dentro de cada grupo, las subcategorías reparten esa cuota
            (sus porcentajes deben sumar 100%). Todo lo que metes aquí cuenta como GFA — las áreas
            que <em>no</em> cuentan como GFA (piscinas, padel, ...) irán en un bloque aparte abajo.
          </p>
        </div>

        {residentialBUATotal <= 0 && (
          <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12.5px] mb-4 leading-snug">
            Set <strong>Residential GFA</strong> in Setup&apos;s GFA breakdown to drive
            this table.
          </div>
        )}

        {residentialBUATotal > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <Stat label="Σ Group GFA quota" value={`${fmt0(totalQuota)} m²`} sub={fmtSqft(totalQuota)} />
            <Stat label="Σ Delivered GFA" value={`${fmt0(totalGFA)} m²`} sub={fmtSqft(totalGFA)} />
            <Stat
              label="Quota mismatch"
              value={Math.abs(totalGFA - totalQuota) < 1 ? "—" : `${(totalGFA - totalQuota).toFixed(0)} m²`}
              sub={Math.abs(totalGFA - totalQuota) < 1 ? "GFA matches quota" : "rebalance groups"}
            />
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
  const sumPct = subs.reduce((s, x) => s + x.pct, 0);
  const mismatch = subs.length > 0 && Math.abs(sumPct - 100) > 0.5;
  const deliveredM2 = (groupGFAQuota * sumPct) / 100;

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
          <div className="eyebrow text-ink-500 text-[10px]">Delivered</div>
          <div className="text-[12px] text-qube-800 font-medium tabular-nums">
            {deliveredM2 > 0 ? `${Math.round(deliveredM2).toLocaleString("en-US")} m²` : "—"}
          </div>
          {mismatch && (
            <div className="text-[10px] text-amber-700 mt-0.5">
              Σ {sumPct.toFixed(1)}% (target 100%)
            </div>
          )}
        </div>
      </div>

      {/* Sub-rows table */}
      <div className="grid grid-cols-[14px_1fr_100px_120px_140px_28px] gap-1 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 border-b border-ink-100 bg-bone-50/40">
        <span></span>
        <span>Subcategory</span>
        <span className="text-right">% of group</span>
        <span className="text-right">m²</span>
        <span className="text-right">≈ sqft</span>
        <span></span>
      </div>
      {subs.map((sub) => {
        const m2 = (groupGFAQuota * sub.pct) / 100;
        return (
          <div
            key={sub.id}
            className="grid grid-cols-[14px_1fr_100px_120px_140px_28px] gap-1 px-3 py-1.5 items-center text-[12px] tabular-nums border-b border-ink-100"
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

      {/* Footer: sum + actions */}
      <div className="grid grid-cols-[14px_1fr_100px_120px_140px_28px] gap-1 px-3 py-1.5 items-center text-[11.5px] tabular-nums bg-bone-50/40">
        <span></span>
        <span className="uppercase tracking-[0.08em] text-[10.5px] text-ink-500">Sum</span>
        <span className={`text-right ${mismatch ? "text-amber-700 font-medium" : "text-ink-700"}`}>{sumPct.toFixed(1)}%</span>
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-ink-100">
        <button onClick={onAdd} className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline">
          + Add subcategory
        </button>
        {mismatch && (
          <button
            onClick={onRebalance}
            className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
            title="Scale every row proportionally so the sum equals 100%"
          >Rebalance to 100%</button>
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
