"use client";
import { useMemo } from "react";
import { useProject, useStore } from "@/lib/store";
import {
  residentialSubPct,
  residentialSubQuota,
  residentialGFATarget,
} from "@/lib/calc/gfa";
import { computeProgram } from "@/lib/calc/program";
import { computeTowerYield } from "@/lib/calc/tower-yield";
import {
  DEFAULT_BUA_COST_RATES,
  type BuaCostBucketKey,
  type BuaCostCase,
  type GfaUseCategory,
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
function fmt0(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
/** Compact money: 66,750,000 → "66.8M". Full value in the title tooltip. */
function fmtAED(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")}k`;
  return `${Math.round(n)}`;
}

const COST_CASES: BuaCostCase[] = ["premium", "medium", "low"];
const COST_CASE_LABEL: Record<BuaCostCase, string> = {
  premium: "Premium",
  medium: "Medium",
  low: "Low",
};

const OTHER_USES: { key: GfaUseCategory; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "commercial", label: "Commercial / Office" },
  { key: "hospitality", label: "Hospitality" },
];

export default function SummaryTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);

  const target = project.targetGFA ?? 0;

  // Effective construction rates: project override → default seed.
  function rateFor(bucket: BuaCostBucketKey, c: BuaCostCase): number {
    const v = project.buaCostRates?.[bucket]?.[c];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_BUA_COST_RATES[bucket][c];
  }
  function setRate(bucket: BuaCostBucketKey, c: BuaCostCase, v: number) {
    const next = {
      ...project.buaCostRates,
      [bucket]: { ...project.buaCostRates?.[bucket], [c]: Number.isFinite(v) && v >= 0 ? v : undefined },
    };
    patch({ buaCostRates: next });
  }

  // ── Residential breakdown ───────────────────────────────────────────────
  const residentialGfaTotal = useMemo(() => residentialGFATarget(project), [project]);
  const program = useMemo(() => computeProgram(project), [project]);
  const yield_ = useMemo(() => computeTowerYield(project), [project]);

  // ── Other uses (no sub-breakdown today → BUA = GFA) ─────────────────────
  function useM2(key: GfaUseCategory): number {
    const item = project.gfaBreakdown?.[key];
    if (!item) return 0;
    return item.mode === "absolute" ? item.value : (item.value / 100) * target;
  }
  function useFormula(key: GfaUseCategory): string {
    const item = project.gfaBreakdown?.[key];
    if (!item) return "";
    return item.mode === "absolute"
      ? "entered in Setup (absolute m²)"
      : `${item.value}% × Target GFA ${fmt0(target)} m²`;
  }
  const otherUses = OTHER_USES.map((u) => ({ ...u, gfa: useM2(u.key), formula: useFormula(u.key) }))
    .filter((u) => u.gfa > 0);
  const otherUsesGFA = otherUses.reduce((s, u) => s + u.gfa, 0);

  const totalGFA = residentialGfaTotal + otherUsesGFA;

  // ── Construction cost buckets (BUA) ─────────────────────────────────────
  // Residential quotas, each a % of the residential GFA (Distribution tab).
  const aptPct = residentialSubPct(project, "apartments");
  const amenitiesPct = residentialSubPct(project, "amenities");
  const circulationPct = residentialSubPct(project, "circulation");
  const servicesPct = residentialSubPct(project, "services");
  const aptInteriorBUA = residentialSubQuota(project, "apartments");
  const amenitiesBUA = residentialSubQuota(project, "amenities");
  const circulationBUA = residentialSubQuota(project, "circulation");
  const servicesBUA = residentialSubQuota(project, "services");

  // Balconies ride on the apartments quota at the balcony share measured in
  // the Apartments matrix (Σ balconies / Σ interiors of the placed units).
  const balconyShare = program.totalInteriorGFA > 0 ? program.totalBalcony / program.totalInteriorGFA : 0;
  const balconiesBUA = aptInteriorBUA * balconyShare;

  // Ground + podium shell: floor counts from Setup × the floor-plate areas
  // entered in Distribution. Falls back to the non-residential use GFA when
  // no footprints are set (those uses live in the ground/podium levels).
  const groundPodiumShell = yield_.groundGFA + yield_.podiumGFA;
  const groundPodiumBUA = groundPodiumShell > 0 ? groundPodiumShell : otherUsesGFA;
  const groundPodiumFallback = groundPodiumShell <= 0 && otherUsesGFA > 0;

  // Basements: levels from Setup × footprint (Parking override, else plot area).
  const basementCount = project.basements?.count ?? 0;
  const basementFootprint = project.basementFootprintM2 ?? project.plotArea ?? 0;
  const basementsBUA = basementCount * basementFootprint;

  const constructionBUA =
    aptInteriorBUA + balconiesBUA + amenitiesBUA + circulationBUA + servicesBUA + groundPodiumBUA + basementsBUA;

  // ── GSA (sellable) ──────────────────────────────────────────────────────
  const gsaTotal = aptInteriorBUA + balconiesBUA;

  const gfaOverTarget = target > 0 && totalGFA > target + 1;

  type Bucket = { key: BuaCostBucketKey; label: string; formula: string; m2: number; note?: string };
  const buckets: Bucket[] = [
    {
      key: "apartmentsInterior",
      label: "Apartments interior",
      formula: `Residential GFA ${fmt0(residentialGfaTotal)} m² × ${aptPct.toFixed(1)}% apartments`,
      m2: aptInteriorBUA,
    },
    {
      key: "balconies",
      label: "Balconies",
      formula:
        balconyShare > 0
          ? `Apartments ${fmt0(aptInteriorBUA)} m² × ${(balconyShare * 100).toFixed(1)}% balcony share (from the Apartments matrix)`
          : "No balcony share yet — fill the Apartments matrix so balconies can be measured",
      m2: balconiesBUA,
    },
    {
      key: "amenities",
      label: "Amenities (residential)",
      formula: `Residential GFA ${fmt0(residentialGfaTotal)} m² × ${amenitiesPct.toFixed(1)}%`,
      m2: amenitiesBUA,
    },
    {
      key: "circulation",
      label: "Circulation (residential)",
      formula: `Residential GFA ${fmt0(residentialGfaTotal)} m² × ${circulationPct.toFixed(1)}%`,
      m2: circulationBUA,
    },
    {
      key: "services",
      label: "Services (MEP / shafts)",
      formula: `Residential GFA ${fmt0(residentialGfaTotal)} m² × ${servicesPct.toFixed(1)}% — BUA only, not GFA`,
      m2: servicesBUA,
    },
    {
      key: "groundPodium",
      label: "Ground floor + podium",
      formula: groundPodiumFallback
        ? "Retail + Commercial + Hospitality GFA (no ground/podium floor plates set in Distribution)"
        : [
            yield_.groundFootprintM2 > 0
              ? `${yield_.groundCount} ground × ${fmt0(yield_.groundFootprintM2)} m²`
              : null,
            yield_.podiumFootprintM2 > 0 && yield_.podiumCount > 0
              ? `${yield_.podiumCount} podium × ${fmt0(yield_.podiumFootprintM2)} m²`
              : null,
          ]
            .filter(Boolean)
            .join("  +  ") || "Set ground/podium floor plates in Distribution",
      m2: groundPodiumBUA,
      note: groundPodiumFallback
        ? undefined
        : "Retail / commercial / hospitality GFA sits inside these levels — not double-counted.",
    },
    {
      key: "basements",
      label: "Basements",
      formula:
        basementCount > 0
          ? `${basementCount} level${basementCount === 1 ? "" : "s"} × ${fmt0(basementFootprint)} m² ${
              project.basementFootprintM2 ? "(footprint override from Parking)" : "(plot area)"
            }`
          : "No basement levels in Setup",
      m2: basementsBUA,
    },
  ];

  // ── Efficiency ratios ───────────────────────────────────────────────────
  const ratios = [
    {
      label: "GSA / GFA",
      num: gsaTotal,
      den: totalGFA,
      numLabel: "GSA",
      denLabel: "GFA",
      hint: "Sellable share of the gross floor area — how much of the FAR-counted area you can sell.",
    },
    {
      label: "GFA / BUA",
      num: totalGFA,
      den: constructionBUA,
      numLabel: "GFA",
      denLabel: "BUA",
      hint: "FAR-counted share of everything you build — the rest (basements, services, balconies...) costs money but consumes no GFA.",
    },
    {
      label: "GSA / BUA",
      num: gsaTotal,
      den: constructionBUA,
      numLabel: "GSA",
      denLabel: "BUA",
      hint: "Sellable share of everything you build — the headline construction efficiency of the scheme.",
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="section-title">Areas summary</h2>
            <p className="section-sub">
              Live-computed from Setup → GFA breakdown, Distribution, the Apartments matrix and
              Parking. Every headline number shows how it is built below.
            </p>
          </div>
        </div>

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Stat label="Target GFA" value={target > 0 ? fmtM2(target) : "—"} sub={fmtSqft(target)} />
          <Stat
            label="Σ GFA total"
            value={fmtM2(totalGFA)}
            sub={fmtSqft(totalGFA)}
            good={target > 0 && Math.abs(totalGFA - target) < 1}
            bad={gfaOverTarget}
          />
          <Stat
            label="Σ BUA total (construction)"
            value={fmtM2(constructionBUA)}
            sub={fmtSqft(constructionBUA)}
          />
          <Stat
            label="GSA total (sellable)"
            value={fmtM2(gsaTotal)}
            sub={fmtSqft(gsaTotal)}
          />
        </div>

        {/* Warnings */}
        {gfaOverTarget && (
          <p className="text-[11.5px] text-amber-900 mb-3 leading-snug">
            Σ GFA = {fmtM2(totalGFA)} exceeds the Target GFA of {fmtM2(target)} by{" "}
            <strong>{fmtM2(totalGFA - target)}</strong>. Reduce a use allocation or rebalance
            in <em>Setup → GFA breakdown</em>.
          </p>
        )}

        {/* GFA derivation */}
        <DerivBlock title="GFA total — how it's built">
          <DerivRow
            label="Residential GFA"
            formula={
              project.gfaBreakdown?.residential
                ? project.gfaBreakdown.residential.mode === "absolute"
                  ? "entered in Setup (absolute m²)"
                  : `${project.gfaBreakdown.residential.value}% × Target GFA ${fmt0(target)} m²`
                : "not set in Setup"
            }
            m2={residentialGfaTotal}
          />
          {otherUses.map((u) => (
            <DerivRow key={u.key} label={`${u.label} GFA`} formula={u.formula} m2={u.gfa} />
          ))}
          <DerivRow
            label="Σ GFA total"
            formula={
              target > 0
                ? `vs Target GFA ${fmt0(target)} m² (${totalGFA > target + 1 ? "+" : ""}${fmt0(totalGFA - target)} m²)`
                : "no Target GFA set"
            }
            m2={totalGFA}
            total
          />
        </DerivBlock>

        {/* GSA derivation */}
        <DerivBlock title="GSA total (sellable) — how it's built">
          <DerivRow
            label="Apartments interior"
            formula={`Residential GFA ${fmt0(residentialGfaTotal)} m² × ${aptPct.toFixed(1)}% apartments`}
            m2={aptInteriorBUA}
          />
          <DerivRow
            label="Balconies"
            formula={
              balconyShare > 0
                ? `× ${(balconyShare * 100).toFixed(1)}% balcony share from the Apartments matrix`
                : "0 — fill the Apartments matrix to measure the balcony share"
            }
            m2={balconiesBUA}
          />
          <DerivRow label="GSA total" formula="apartments interior + balconies" m2={gsaTotal} total />
          {program.totalSellable > 0 && (
            <p className="text-[10.5px] text-ink-500 px-3 py-1.5 leading-snug border-t border-ink-100">
              Cross-check: the Apartments matrix currently places {program.totalUnits} units ={" "}
              {fmt0(program.totalSellable)} m² sellable ({fmt0(program.totalInteriorGFA)} m² interior +{" "}
              {fmt0(program.totalBalcony)} m² balconies).
            </p>
          )}
        </DerivBlock>

        {/* BUA construction buckets + cost per case */}
        <DerivBlock title="BUA total (construction) — by cost category · cost per case (AED)">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <colgroup>
                <col style={{ minWidth: 170 }} />
                <col style={{ minWidth: 260 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 92 }} />
              </colgroup>
              <thead>
                <tr className="bg-bone-50 border-b border-ink-200 text-[10px] uppercase tracking-[0.08em] text-ink-500">
                  <th className="text-left px-3 py-2 font-medium">Cost category</th>
                  <th className="text-left px-2 py-2 font-medium">How it&apos;s computed</th>
                  <th className="text-right px-2 py-2 font-medium">BUA m²</th>
                  {COST_CASES.map((c) => (
                    <th key={c} className="text-right px-2 py-2 font-medium text-qube-700">{COST_CASE_LABEL[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.key} className="border-t border-ink-100">
                    <td className="px-3 py-1.5 text-ink-900">{b.label}</td>
                    <td className="px-2 py-1.5 text-[11px] text-ink-500 leading-snug">
                      {b.formula}
                      {b.note && <span className="block text-ink-400">{b.note}</span>}
                    </td>
                    <td className="text-right px-2 py-1.5">{b.m2 > 0 ? fmt0(b.m2) : "—"}</td>
                    {COST_CASES.map((c) => {
                      const cost = b.m2 * rateFor(b.key, c);
                      return (
                        <td
                          key={c}
                          className="text-right px-2 py-1.5 text-ink-700"
                          title={
                            b.m2 > 0
                              ? `${fmt0(b.m2)} m² × ${fmt0(rateFor(b.key, c))} AED/m² = ${fmt0(cost)} AED`
                              : undefined
                          }
                        >
                          {fmtAED(cost)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-qube-50 font-medium text-qube-800 border-t-2 border-qube-200">
                  <td className="px-3 py-1.5">Σ BUA total (construction)</td>
                  <td className="px-2 py-1.5 text-[11px] font-normal text-qube-700">
                    sum of all categories · costs = Σ (m² × rate per case)
                  </td>
                  <td className="text-right px-2 py-1.5">{constructionBUA > 0 ? fmt0(constructionBUA) : "—"}</td>
                  {COST_CASES.map((c) => {
                    const total = buckets.reduce((s, b) => s + b.m2 * rateFor(b.key, c), 0);
                    return (
                      <td key={c} className="text-right px-2 py-1.5" title={total > 0 ? `${fmt0(total)} AED` : undefined}>
                        {fmtAED(total)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-ink-500 px-3 py-1.5 leading-snug border-t border-ink-100">
            Each category carries a different construction rate. Residential rows are quotas of the
            residential GFA (Distribution); ground/podium and basements are shell areas (floors ×
            floor plate). Basements and services count as BUA but not GFA. Hover a cost for the full
            figure. Rates are editable below.
          </p>
        </DerivBlock>

        {/* Editable construction rates */}
        <DerivBlock title="Construction rates (AED / m² BUA) — editable per case">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <colgroup>
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr className="bg-bone-50 border-b border-ink-200 text-[10px] uppercase tracking-[0.08em] text-ink-500">
                  <th className="text-left px-3 py-2 font-medium">Cost category</th>
                  {COST_CASES.map((c) => (
                    <th key={c} className="text-right px-2 py-2 font-medium text-qube-700">{COST_CASE_LABEL[c]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.key} className="border-t border-ink-100">
                    <td className="px-3 py-1 text-ink-900">{b.label}</td>
                    {COST_CASES.map((c) => (
                      <td key={c} className="text-right px-2 py-1">
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={Math.round(rateFor(b.key, c))}
                          onChange={(e) => setRate(b.key, c, e.target.valueAsNumber)}
                          className="w-[110px] text-right border border-ink-200 px-2 py-1 text-[12px] tabular-nums focus:outline-none focus:border-qube-400"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-ink-500 px-3 py-1.5 leading-snug border-t border-ink-100">
            Indicative UAE rates seeded as defaults — adjust to your cost plan. Saved with the
            project, so each project can carry its own basis.
          </p>
        </DerivBlock>
      </div>

      {/* Efficiency ratios */}
      <div className="card">
        <div className="mb-4">
          <h2 className="section-title">Efficiency ratios</h2>
          <p className="section-sub">
            Computed from the three totals above — GSA {fmtM2(gsaTotal)}, GFA {fmtM2(totalGFA)},
            BUA {fmtM2(constructionBUA)}.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {ratios.map((r) => {
            const ok = r.num > 0 && r.den > 0;
            return (
              <div key={r.label} className="border border-ink-200 bg-white p-4">
                <div className="eyebrow text-ink-500 text-[10px]">{r.label}</div>
                <div className="text-[26px] font-light tabular-nums mt-1 text-ink-900">
                  {ok ? `${((r.num / r.den) * 100).toFixed(1)}%` : "—"}
                </div>
                <div className="text-[11px] text-ink-500 mt-1 tabular-nums">
                  {ok
                    ? `${r.numLabel} ${fmt0(r.num)} m² ÷ ${r.denLabel} ${fmt0(r.den)} m²`
                    : "needs both totals above"}
                </div>
                <p className="text-[10.5px] text-ink-400 mt-2 leading-snug">{r.hint}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DerivBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-ink-200 mb-4">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 text-[10.5px] uppercase tracking-[0.10em] text-ink-600 font-medium">
        {title}
      </div>
      {children}
    </div>
  );
}

function DerivRow({
  label, formula, m2, note, total,
}: { label: string; formula: string; m2: number; note?: string; total?: boolean }) {
  return (
    <div
      className={`grid grid-cols-[190px_minmax(0,1fr)_110px_110px] gap-2 px-3 py-1.5 items-baseline border-t first:border-t-0 ${
        total ? "bg-qube-50 border-qube-200 font-medium text-qube-800" : "border-ink-100"
      }`}
    >
      <div className={`text-[12px] ${total ? "" : "text-ink-900"}`}>{label}</div>
      <div className="text-[11px] text-ink-500 leading-snug">
        {formula}
        {note && <span className="block text-ink-400">{note}</span>}
      </div>
      <div className="text-right text-[12px] tabular-nums">{m2 > 0 ? `${fmt0(m2)} m²` : "—"}</div>
      <div className="text-right text-[11px] tabular-nums text-ink-500">
        {m2 > 0 ? `${fmt0(m2 * M2_TO_SQFT)} sqft` : "—"}
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
