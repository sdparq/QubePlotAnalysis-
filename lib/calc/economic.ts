import type { Project, Typology } from "../types";
import { computeProgram } from "./program";

export interface TypologyRevenue {
  typology: Typology;
  units: number;
  sellablePerUnit: number;
  totalSellable: number;
  pricePerM2: number;
  pricePerUnit: number;
  totalRevenue: number;
  pctOfRevenue: number;
}

export interface CostLine {
  key: string;
  label: string;
  amount: number;
  basis: string;
  pctOfTotalCost: number;
  pctOfRevenue: number;
}

export interface EconomicResult {
  currency: string;
  /** Revenue */
  perTypologyRevenue: TypologyRevenue[];
  residentialRevenue: number;
  parkingRevenue: number;
  retailRevenue: number;
  totalRevenue: number; // GDV
  /** Cost lines, in order */
  costs: CostLine[];
  totalCost: number; // TDC
  /** KPIs */
  profit: number;
  marginOnCost: number;
  marginOnGDV: number;
  /** Land as percentage of total cost */
  landSharePct: number;
  /** Per-area metrics */
  avgPricePerM2Sellable: number;
  avgPricePerUnit: number;
  costPerM2GFA: number;
  costPerM2BUA: number;
  costPerM2Sellable: number;
  /** Reference figures */
  totalUnits: number;
  totalGFA: number;
  totalBUA: number;
  totalSellable: number;
}

const DEFAULTS = {
  softCostsPct: 0.06,
  marketingPct: 0.04,
  permitsPct: 0.02,
  contingencyPct: 0.05,
  financingPct: 0.03,
  brokeragePct: 0.02,
  brandingFeePct: 0,
};

export function computeEconomic(project: Project): EconomicResult {
  const program = computeProgram(project);
  const cfg = project.economic ?? {};
  const currency = cfg.currency ?? "AED";

  // ---- Revenue ----
  const pricing = cfg.typologyPricing ?? {};
  const residentialBeforePct: TypologyRevenue[] = program.byTypology
    .filter((ts) => ts.totalUnits > 0)
    .map((ts) => {
      const pricePerM2 = Number(pricing[ts.typology.id] ?? 0);
      const sellablePerUnit = ts.totalUnits > 0 ? ts.totalSellable / ts.totalUnits : 0;
      const pricePerUnit = sellablePerUnit * pricePerM2;
      const totalRevenue = ts.totalSellable * pricePerM2;
      return {
        typology: ts.typology,
        units: ts.totalUnits,
        sellablePerUnit,
        totalSellable: ts.totalSellable,
        pricePerM2,
        pricePerUnit,
        totalRevenue,
        pctOfRevenue: 0,
      };
    });
  const residentialRevenue = residentialBeforePct.reduce((s, r) => s + r.totalRevenue, 0);

  const parkingSpacesForSale = Math.max(0, cfg.parkingSpacesForSale ?? 0);
  const parkingPricePerSpace = Math.max(0, cfg.parkingPricePerSpace ?? 0);
  const parkingRevenue = parkingSpacesForSale * parkingPricePerSpace;

  const retailRevenue = Math.max(0, cfg.retailRevenue ?? 0);

  const totalRevenue = residentialRevenue + parkingRevenue + retailRevenue;

  // Now we can compute per-typology pct of revenue
  const perTypologyRevenue = residentialBeforePct.map((r) => ({
    ...r,
    pctOfRevenue: totalRevenue > 0 ? r.totalRevenue / totalRevenue : 0,
  }));

  // ---- Costs ----
  const landCost = Math.max(0, cfg.landCost ?? 0);
  const rate = Math.max(0, cfg.constructionRatePerBUA ?? 0);
  const constructionCost = program.totalBUABuilding * rate;

  const softPct = cfg.softCostsPct ?? DEFAULTS.softCostsPct;
  const marketingPct = cfg.marketingPct ?? DEFAULTS.marketingPct;
  const permitsPct = cfg.permitsPct ?? DEFAULTS.permitsPct;
  const contingencyPct = cfg.contingencyPct ?? DEFAULTS.contingencyPct;
  const financingPct = cfg.financingPct ?? DEFAULTS.financingPct;
  const brokeragePct = cfg.brokeragePct ?? DEFAULTS.brokeragePct;
  const brandingFeePct = cfg.brandingFeePct ?? DEFAULTS.brandingFeePct;

  const softCosts = constructionCost * softPct;
  const permitsCost = constructionCost * permitsPct;
  const contingencyCost = (constructionCost + softCosts) * contingencyPct;
  const financingCost = constructionCost * financingPct;
  const marketingCost = totalRevenue * marketingPct;
  const brokerageCost = totalRevenue * brokeragePct;
  const brandingFee = totalRevenue * brandingFeePct;

  const totalCost =
    landCost +
    constructionCost +
    softCosts +
    permitsCost +
    contingencyCost +
    financingCost +
    marketingCost +
    brokerageCost +
    brandingFee;

  const lines: { key: string; label: string; amount: number; basis: string }[] = [
    { key: "land", label: "Land acquisition", amount: landCost, basis: "Direct input" },
    { key: "construction", label: "Construction", amount: constructionCost, basis: `BUA × ${rate.toLocaleString()} ${currency}/m²` },
    { key: "soft", label: "Soft costs (design / consultants)", amount: softCosts, basis: `${(softPct * 100).toFixed(1)}% of construction` },
    { key: "permits", label: "Permits & DM fees", amount: permitsCost, basis: `${(permitsPct * 100).toFixed(1)}% of construction` },
    { key: "contingency", label: "Contingency", amount: contingencyCost, basis: `${(contingencyPct * 100).toFixed(1)}% of (construction + soft)` },
    { key: "financing", label: "Financing during construction", amount: financingCost, basis: `${(financingPct * 100).toFixed(1)}% of construction` },
    { key: "marketing", label: "Marketing & sales", amount: marketingCost, basis: `${(marketingPct * 100).toFixed(1)}% of GDV` },
    { key: "brokerage", label: "Brokerage / agency", amount: brokerageCost, basis: `${(brokeragePct * 100).toFixed(1)}% of GDV` },
  ];
  if (brandingFeePct > 0) {
    lines.push({ key: "branding", label: "Branding fee", amount: brandingFee, basis: `${(brandingFeePct * 100).toFixed(1)}% of GDV` });
  }
  const costs: CostLine[] = lines.map((l) => ({
    ...l,
    pctOfTotalCost: totalCost > 0 ? l.amount / totalCost : 0,
    pctOfRevenue: totalRevenue > 0 ? l.amount / totalRevenue : 0,
  }));

  const profit = totalRevenue - totalCost;
  const marginOnCost = totalCost > 0 ? profit / totalCost : 0;
  const marginOnGDV = totalRevenue > 0 ? profit / totalRevenue : 0;

  const totalSellable = program.totalSellable;
  const totalUnits = program.totalUnits;
  const avgPricePerM2Sellable = totalSellable > 0 ? residentialRevenue / totalSellable : 0;
  const avgPricePerUnit = totalUnits > 0 ? residentialRevenue / totalUnits : 0;
  const costPerM2GFA = program.totalGFABuilding > 0 ? totalCost / program.totalGFABuilding : 0;
  const costPerM2BUA = program.totalBUABuilding > 0 ? totalCost / program.totalBUABuilding : 0;
  const costPerM2Sellable = totalSellable > 0 ? totalCost / totalSellable : 0;

  return {
    currency,
    perTypologyRevenue,
    residentialRevenue,
    parkingRevenue,
    retailRevenue,
    totalRevenue,
    costs,
    totalCost,
    profit,
    marginOnCost,
    marginOnGDV,
    landSharePct: totalCost > 0 ? landCost / totalCost : 0,
    avgPricePerM2Sellable,
    avgPricePerUnit,
    costPerM2GFA,
    costPerM2BUA,
    costPerM2Sellable,
    totalUnits,
    totalGFA: program.totalGFABuilding,
    totalBUA: program.totalBUABuilding,
    totalSellable,
  };
}
