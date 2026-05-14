"use client";
import { useStore, useProject } from "@/lib/store";
import { computeEconomic } from "@/lib/calc/economic";
import { fmt0, fmt2, fmtMoney, fmtMoneyShort, fmtPct } from "@/lib/format";
import type { EconomicConfig } from "@/lib/types";

const CURRENCIES = ["AED", "USD", "EUR", "SAR", "GBP"];

export default function EconomicTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const r = computeEconomic(project);
  const cfg = project.economic ?? {};
  const currency = r.currency;

  function setCfg(p: Partial<EconomicConfig>) {
    patch({ economic: { ...cfg, ...p } });
  }
  function setTypologyPrice(typologyId: string, price: number) {
    const next = { ...(cfg.typologyPricing ?? {}) };
    if (price > 0) next[typologyId] = price;
    else delete next[typologyId];
    setCfg({ typologyPricing: next });
  }

  const constructionRateAuto = r.defaults.constructionRatePerBUA;
  const constructionRateManual = cfg.constructionRatePerBUA ?? 0;
  const constructionRateUsesAuto = constructionRateManual <= 0 && constructionRateAuto > 0;

  return (
    <div className="grid gap-6">
      {/* ---------- Top KPIs ---------- */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="GDV (Revenue)" value={fmtMoneyShort(r.totalRevenue, currency)} sub={fmtMoney(r.totalRevenue, currency)} />
        <Kpi label="TDC (Cost)" value={fmtMoneyShort(r.totalCost, currency)} sub={fmtMoney(r.totalCost, currency)} />
        <Kpi
          label="Gross profit"
          value={fmtMoneyShort(r.grossProfit, currency)}
          sub="GDV − TDC"
          tone={r.grossProfit > 0 ? "good" : r.grossProfit < 0 ? "bad" : undefined}
        />
        <Kpi
          label={`Corporate tax ${fmtPct(r.corporateTaxRate)}`}
          value={fmtMoneyShort(r.corporateTax, currency)}
          sub={r.corporateTaxExemption > 0 ? `Exempt up to ${fmtMoneyShort(r.corporateTaxExemption, currency)}` : "UAE CT on gross profit"}
        />
        <Kpi
          label="Net profit"
          value={fmtMoneyShort(r.profit, currency)}
          sub="After UAE corporate tax"
          tone={r.profit > 0 ? "good" : r.profit < 0 ? "bad" : undefined}
        />
        <Kpi
          label="Net margin / GDV"
          value={fmtPct(r.marginOnGDV)}
          sub={`Gross ${fmtPct(r.grossMarginOnGDV)}`}
          tone={r.marginOnGDV > 0.15 ? "good" : r.marginOnGDV < 0 ? "bad" : undefined}
        />
      </section>

      {/* ---------- Auto-fill banner ---------- */}
      {r.detectedClass && (
        <div className="border border-qube-200 bg-qube-50 text-[12.5px] text-ink-700 p-3 leading-snug">
          <span className="font-medium text-qube-800">Auto-fill from class {r.detectedClass}</span>
          {" — "}sale prices, construction rate ({r.defaults.heightTierLabel || "—"}) and other figures are
          pre-filled from the OMRT/QUBE matrix. Any value you type overrides the auto value; clear a field
          to fall back to the class default.
        </div>
      )}

      {/* ---------- Pricing per typology ---------- */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Sales pricing per typology</h2>
            <p className="section-sub">
              Defaults come from the class library (AED/SqFt → AED/m², mid-range). Type a number to override.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] uppercase tracking-[0.10em] text-ink-500">Currency</label>
            <select
              className="cell-input !w-24"
              value={currency}
              onChange={(e) => setCfg({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {r.perTypologyRevenue.length === 0 ? (
          <div className="text-sm text-ink-500 italic py-6 text-center">
            No typologies with units yet. Fill the Typologies and Program tabs first.
          </div>
        ) : (
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 70 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Typology</th>
                <th className="text-right">Units</th>
                <th className="text-right">Sellable / unit (m²)</th>
                <th className="text-right">Price / m² ({currency})</th>
                <th className="text-right">Price / unit ({currency})</th>
                <th className="text-right">Revenue ({currency})</th>
                <th className="text-right">% GDV</th>
              </tr>
            </thead>
            <tbody>
              {r.perTypologyRevenue.map((row) => {
                const manual = cfg.typologyPricing?.[row.typology.id] ?? 0;
                const usesAuto = !manual && row.pricePerM2Auto > 0;
                return (
                  <tr key={row.typology.id}>
                    <td className="font-medium text-ink-900">
                      {row.typology.name}
                      <span className="text-ink-400 text-xs ml-2">{row.typology.category}</span>
                    </td>
                    <td className="text-right">{fmt0(row.units)}</td>
                    <td className="text-right tabular-nums">{fmt2(row.sellablePerUnit)}</td>
                    <td className="cell-edit">
                      <div className="grid">
                        <input
                          type="number"
                          min={0}
                          step={50}
                          className={`cell-input text-right ${usesAuto ? "text-ink-500 italic" : ""}`}
                          value={manual || ""}
                          placeholder={row.pricePerM2Auto > 0 ? fmt0(row.pricePerM2Auto) : "0"}
                          onChange={(e) => setTypologyPrice(row.typology.id, parseFloat(e.target.value) || 0)}
                        />
                        {usesAuto && (
                          <span className="text-[9.5px] text-qube-700 text-right mt-0.5">auto</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{fmt0(row.pricePerUnit)}</td>
                    <td className="text-right tabular-nums">{fmt0(row.totalRevenue)}</td>
                    <td className="text-right text-ink-500 text-xs">{fmtPct(row.pctOfRevenue)}</td>
                  </tr>
                );
              })}
              <tr className="row-total">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">
                  Residential subtotal
                </td>
                <td className="text-right text-[11px] text-ink-500">avg {fmt0(r.avgPricePerM2Sellable)}</td>
                <td className="text-right">{fmt0(r.avgPricePerUnit)}</td>
                <td className="text-right">{fmt0(r.residentialRevenue)}</td>
                <td className="text-right">
                  {fmtPct(r.totalRevenue > 0 ? r.residentialRevenue / r.totalRevenue : 0)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          <Field label={`Parking spaces sold`}>
            <NumInput
              value={cfg.parkingSpacesForSale ?? 0}
              step={1}
              min={0}
              onChange={(v) => setCfg({ parkingSpacesForSale: v })}
            />
          </Field>
          <Field label={`Price per space (${currency})`}>
            <NumInput
              value={cfg.parkingPricePerSpace ?? 0}
              step={1000}
              min={0}
              onChange={(v) => setCfg({ parkingPricePerSpace: v })}
            />
          </Field>
          <Field label={`Retail / F&B revenue (${currency})`}>
            <NumInput
              value={cfg.retailRevenue ?? 0}
              step={10000}
              min={0}
              onChange={(v) => setCfg({ retailRevenue: v })}
            />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <Stat label="Residential" value={fmtMoneyShort(r.residentialRevenue, currency)} />
          <Stat label="Parking" value={fmtMoneyShort(r.parkingRevenue, currency)} />
          <Stat label="Retail" value={fmtMoneyShort(r.retailRevenue, currency)} />
        </div>
      </div>

      {/* ---------- Costs inputs ---------- */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Costs</h2>
          <p className="section-sub">
            Land is a direct input. Construction rate auto-fills from the class library; everything else
            uses % defaults you can adjust per project.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label={`Land acquisition (${currency})`}>
            <NumInput
              value={cfg.landCost ?? 0}
              step={100000}
              min={0}
              onChange={(v) => setCfg({ landCost: v })}
            />
          </Field>
          <Field label={`Construction rate (${currency} / m² BUA)`}>
            <div className="grid">
              <NumInput
                value={constructionRateManual || (constructionRateUsesAuto ? constructionRateAuto : 0)}
                step={50}
                min={0}
                italic={constructionRateUsesAuto}
                onChange={(v) => setCfg({ constructionRatePerBUA: v })}
              />
              {constructionRateUsesAuto && (
                <span className="text-[10px] text-qube-700 mt-0.5">
                  auto · class {r.detectedClass} · {r.defaults.heightTierLabel}
                </span>
              )}
            </div>
          </Field>
          <PctField label="Soft costs (% of construction)" value={cfg.softCostsPct ?? 0.06} onChange={(v) => setCfg({ softCostsPct: v })} />
          <PctField label="Permits & DM fees (% of construction)" value={cfg.permitsPct ?? 0.02} onChange={(v) => setCfg({ permitsPct: v })} />
          <PctField label="Contingency (% of construction + soft)" value={cfg.contingencyPct ?? 0.05} onChange={(v) => setCfg({ contingencyPct: v })} />
          <PctField label="Financing (% of construction)" value={cfg.financingPct ?? 0.06} onChange={(v) => setCfg({ financingPct: v })} />
          <PctField label="Marketing (% of GDV)" value={cfg.marketingPct ?? 0.01} onChange={(v) => setCfg({ marketingPct: v })} />
          <PctField label="Sales / brokerage (% of GDV)" value={cfg.brokeragePct ?? 0.07} onChange={(v) => setCfg({ brokeragePct: v })} />
          <PctField label="Branding fee (% of GDV)" value={cfg.brandingFeePct ?? 0} onChange={(v) => setCfg({ brandingFeePct: v })} />
          <PctField label="UAE corporate tax (% of profit)" value={cfg.corporateTaxPct ?? 0.09} onChange={(v) => setCfg({ corporateTaxPct: v })} />
          <Field label={`Tax exemption (${currency})`}>
            <NumInput
              value={cfg.corporateTaxExemption ?? 0}
              step={25000}
              min={0}
              onChange={(v) => setCfg({ corporateTaxExemption: v })}
            />
          </Field>
        </div>
      </div>

      {/* ---------- Cost breakdown ---------- */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Cost &amp; profit breakdown</h2>
        </div>
        <table className="tbl w-full table-fixed">
          <colgroup>
            <col />
            <col style={{ width: "32%" }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Line</th>
              <th>Basis</th>
              <th className="text-right">Amount ({currency})</th>
              <th className="text-right">% TDC</th>
              <th className="text-right">% GDV</th>
            </tr>
          </thead>
          <tbody>
            {r.costs.map((c) => (
              <tr key={c.key}>
                <td className="font-medium text-ink-900">{c.label}</td>
                <td className="text-ink-500 text-xs">{c.basis}</td>
                <td className="text-right tabular-nums">{fmt0(c.amount)}</td>
                <td className="text-right text-ink-700">{fmtPct(c.pctOfTotalCost)}</td>
                <td className="text-right text-ink-500">{fmtPct(c.pctOfRevenue)}</td>
              </tr>
            ))}
            <tr className="row-total">
              <td colSpan={2} className="uppercase tracking-[0.10em] text-[11px]">Total Development Cost</td>
              <td className="text-right">{fmt0(r.totalCost)}</td>
              <td className="text-right">100%</td>
              <td className="text-right">{fmtPct(r.totalRevenue > 0 ? r.totalCost / r.totalRevenue : 0)}</td>
            </tr>
            <tr>
              <td colSpan={2} className="text-right uppercase tracking-[0.10em] text-[11px] text-ink-600">
                Gross profit (GDV − TDC)
              </td>
              <td className={`text-right tabular-nums ${r.grossProfit >= 0 ? "text-ink-900" : "text-red-700"}`}>{fmt0(r.grossProfit)}</td>
              <td className="text-right text-ink-500">{fmtPct(r.grossMarginOnCost)}</td>
              <td className="text-right text-ink-500">{fmtPct(r.grossMarginOnGDV)}</td>
            </tr>
            <tr>
              <td colSpan={2} className="text-right uppercase tracking-[0.10em] text-[11px] text-ink-600">
                UAE corporate tax {fmtPct(r.corporateTaxRate)}
                {r.corporateTaxExemption > 0 && (
                  <span className="text-ink-400 normal-case tracking-normal text-[10.5px] ml-2">
                    (− {fmtMoneyShort(r.corporateTaxExemption, currency)} exempt)
                  </span>
                )}
              </td>
              <td className="text-right tabular-nums text-red-700">− {fmt0(r.corporateTax)}</td>
              <td className="text-right text-ink-500">—</td>
              <td className="text-right text-ink-500">{fmtPct(r.totalRevenue > 0 ? r.corporateTax / r.totalRevenue : 0)}</td>
            </tr>
            <tr className="row-total">
              <td colSpan={2} className="uppercase tracking-[0.10em] text-[11px]">Net profit (after tax)</td>
              <td className={`text-right tabular-nums ${r.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmt0(r.profit)}</td>
              <td className="text-right">{fmtPct(r.marginOnCost)}</td>
              <td className="text-right">{fmtPct(r.marginOnGDV)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------- Bottom metrics ---------- */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Feasibility metrics</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Kpi label="Avg price / m² sellable" value={fmtMoney(r.avgPricePerM2Sellable, currency)} />
          <Kpi label="Avg price / unit" value={fmtMoney(r.avgPricePerUnit, currency)} />
          <Kpi label="Cost / m² GFA" value={fmtMoney(r.costPerM2GFA, currency)} />
          <Kpi label="Cost / m² BUA" value={fmtMoney(r.costPerM2BUA, currency)} />
          <Kpi label="Cost / m² sellable" value={fmtMoney(r.costPerM2Sellable, currency)} />
          <Kpi label="Land / TDC" value={fmtPct(r.landSharePct)} sub={`${fmtMoneyShort(cfg.landCost ?? 0, currency)} of ${fmtMoneyShort(r.totalCost, currency)}`} />
          <Kpi label="Sellable / GFA" value={fmtPct(r.totalGFA > 0 ? r.totalSellable / r.totalGFA : 0)} sub="Saleable efficiency" />
          <Kpi label="Sellable / BUA" value={fmtPct(r.totalBUA > 0 ? r.totalSellable / r.totalBUA : 0)} sub="On total built area" />
        </div>
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  const cls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink-900";
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${cls}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      <span className="font-medium tabular-nums text-ink-900">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value, onChange, step = 1, min, suffix, italic,
}: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string; italic?: boolean }) {
  return (
    <div className="relative">
      <input
        type="number"
        step={step}
        min={min}
        className={`cell-input ${suffix ? "pr-9" : ""} ${italic ? "text-ink-500 italic" : ""}`}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">{suffix}</span>}
    </div>
  );
}

function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <NumInput
        value={Number((value * 100).toFixed(2))}
        step={0.25}
        min={0}
        suffix="%"
        onChange={(v) => onChange(Math.max(0, v / 100))}
      />
    </Field>
  );
}
