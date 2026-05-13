"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt0 } from "@/lib/format";
import { computeProgram } from "@/lib/calc/program";
import {
  residentialBUA,
  residentialSubBUA,
  residentialSubGFA,
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
  { key: "circulation", label: "Circulation", hint: "Lobbies, corridors, lift cores, stairs." },
  { key: "services",    label: "Services",    hint: "MEP rooms, shafts, ducts, plant rooms." },
];

/** Build the flat CommonArea[] list the rest of the calc engine consumes. */
function buildFlatCommonAreas(
  breakdown: CommonAreasBreakdown,
  groupBUA: Record<CommonAreasGroup, number>,
): CommonArea[] {
  const out: CommonArea[] = [];
  for (const g of GROUPS) {
    const bua = groupBUA[g.key];
    for (const sub of breakdown[g.key]) {
      const area = bua * sub.pct / 100;
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
  const program = computeProgram(project);

  const breakdown: CommonAreasBreakdown = useMemo(
    () => project.commonAreasBreakdown ?? defaultCommonAreasBreakdown(),
    [project.commonAreasBreakdown],
  );

  // Group BUA is sized so its GFA-counted share equals what Setup allocates.
  //   subGFA  = pct × residentialGFA × (countsAsGFA at residential level)
  //   subBUA  = subGFA / subGfaShare    (inflates when Pool/Padel/... are Non-GFA)
  const groupBUA: Record<CommonAreasGroup, number> = {
    amenities:   residentialSubBUA(project, "amenities"),
    circulation: residentialSubBUA(project, "circulation"),
    services:    residentialSubBUA(project, "services"),
  };
  const groupGFAFromSetup: Record<CommonAreasGroup, number> = {
    amenities:   residentialSubGFA(project, "amenities"),
    circulation: residentialSubGFA(project, "circulation"),
    services:    residentialSubGFA(project, "services"),
  };
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
      commonAreas: buildFlatCommonAreas(next, groupBUA),
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

  function rebalanceGroup(group: CommonAreasGroup) {
    const subs = breakdown[group];
    const sum = subs.reduce((s, x) => s + x.pct, 0);
    if (sum <= 0) return;
    const factor = 100 / sum;
    const nextGroup = subs.map((s) => ({ ...s, pct: Number((s.pct * factor).toFixed(2)) }));
    commit({ ...breakdown, [group]: nextGroup });
  }

  // ── Aggregate stats ─────────────────────────────────────────────────────
  const totalBUA = groupBUA.amenities + groupBUA.circulation + groupBUA.services;
  const totalGFA = program.commonAreasGFA;
  const totalOpen = program.commonAreasOpen;
  const totalBUAonly = program.commonAreasBUAonly;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Common Areas &amp; Services</h2>
          <p className="section-sub">
            Subcategorías editables dentro de Amenities, Circulation y Services. Cada sub
            tiene su <strong>%</strong> dentro del grupo y un toggle <strong>GFA / Non-GFA</strong>.
            Las superficies se calculan automáticamente a partir de los m² que el Setup
            asigna a cada grupo (residential BUA × % del grupo).
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
            <Stat label="Counted as BUA-only" value={`${fmt0(totalBUAonly)} m²`} />
            <Stat label="Open / no GFA" value={`${fmt0(totalOpen)} m²`} />
          </div>
        )}

        <div className="grid gap-5">
          {GROUPS.map((g) => (
            <GroupSection
              key={g.key}
              group={g}
              subs={breakdown[g.key]}
              groupBUA={groupBUA[g.key]}
              groupGFAFromSetup={groupGFAFromSetup[g.key]}
              groupPct={groupPct[g.key]}
              onAdd={() => addSub(g.key)}
              onRebalance={() => rebalanceGroup(g.key)}
              onUpdateSub={(id, partial) => updateSub(g.key, id, partial)}
              onDelete={(id) => deleteSub(g.key, id)}
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
  group, subs, groupBUA, groupGFAFromSetup, groupPct, onAdd, onRebalance, onUpdateSub, onDelete,
}: {
  group: GroupDef;
  subs: CommonAreaSub[];
  groupBUA: number;
  groupGFAFromSetup: number;
  groupPct: number;
  onAdd: () => void;
  onRebalance: () => void;
  onUpdateSub: (id: string, partial: Partial<CommonAreaSub>) => void;
  onDelete: (id: string) => void;
}) {
  const sumPct = subs.reduce((s, x) => s + x.pct, 0);
  const mismatch = Math.abs(sumPct - 100) > 0.5;
  const gfaSum = subs.filter((s) => s.countsAsGFA).reduce((sum, s) => sum + groupBUA * s.pct / 100, 0);

  return (
    <div className="border border-ink-200">
      {/* Group header */}
      <div className="grid grid-cols-[1fr_120px_120px_140px] gap-2 items-baseline px-3 py-2 bg-bone-50 border-b border-ink-200">
        <div>
          <div className="text-[14px] font-medium text-ink-900">{group.label}</div>
          <div className="text-[10.5px] text-ink-500 leading-snug">{group.hint}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">From Setup</div>
          <div className="text-[12px] text-ink-900 tabular-nums">{groupPct.toFixed(1)}% residential</div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">Group BUA</div>
          <div className="text-[12px] text-ink-900 tabular-nums">{groupBUA > 0 ? `${Math.round(groupBUA).toLocaleString("en-US")} m²` : "—"}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow text-ink-500 text-[10px]">Of which GFA</div>
          <div className="text-[12px] text-qube-800 font-medium tabular-nums">
            {gfaSum > 0 ? `${Math.round(gfaSum).toLocaleString("en-US")} m²` : "—"}
          </div>
          {groupGFAFromSetup > 0 && Math.abs(gfaSum - groupGFAFromSetup) > 1 && (
            <div className="text-[10px] text-amber-700 mt-0.5">
              vs Setup {Math.round(groupGFAFromSetup).toLocaleString("en-US")} m²
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
        const m2 = groupBUA * sub.pct / 100;
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
                max={100}
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

      {/* Footer: sum + actions */}
      <div className="grid grid-cols-[14px_1fr_90px_100px_110px_120px_28px] gap-1 px-3 py-1.5 items-center text-[11.5px] tabular-nums bg-bone-50/40">
        <span></span>
        <span className="uppercase tracking-[0.08em] text-[10.5px] text-ink-500">Sum</span>
        <span className={`text-right ${mismatch ? "text-amber-700 font-medium" : "text-ink-700"}`}>{sumPct.toFixed(1)}%</span>
        <span></span>
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
