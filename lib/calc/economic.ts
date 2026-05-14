import type { Project, Typology, EconomicConfig } from "../types";
import { computeProgram } from "./program";
import {
  DEFAULT_ZONE_CLASSES,
  classForZone,
  type ZoneClass,
  type ZoneClassRow,
  type TypologyKey,
} from "../zone-classes";

export interface TypologyRevenue {
  typology: Typology;
  units: number;
  sellablePerUnit: number;
  totalSellable: number;
  pricePerM2: number;
  pricePerUnit: number;
  totalRevenue: number;
  pctOfRevenue: number;
  pricePerM2Auto: number;
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
  grossProfit: number;          // GDV − TDC (before tax)
  corporateTax: number;         // UAE 9% on profit above exemption
  corporateTaxRate: number;
  corporateTaxExemption: number;
  profit: number;               // net profit (after corporate tax)
  marginOnCost: number;         // net profit ÷ TDC
  marginOnGDV: number;          // net profit ÷ GDV
  grossMarginOnCost: number;
  grossMarginOnGDV: number;
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
  /** Detected class for auto-fill (null when zone not matched) */
  detectedClass: ZoneClass | null;
  /** Auto-fill suggestions (used when the manual value is absent / zero). */
  defaults: EconomicDefaults;
}

export interface EconomicDefaults {
  constructionRatePerBUA: number;
  retailRevenue: number;
  typologyPricing: Record<string, number>;
  heightTierLabel: string;
}

const DEFAULTS = {
  softCostsPct: 0.06,
  marketingPct: 0.01,
  permitsPct: 0.02,
  contingencyPct: 0.05,
  financingPct: 0.06,
  brokeragePct: 0.07,
  brandingFeePct: 0,
  corporateTaxPct: 0.09,
  corporateTaxExemption: 0,
};

const SQFT_PER_M2 = 10.7639;

const TYPOLOGY_KEY_FOR_CATEGORY: Record<string, TypologyKey> = {
  Studio: "studio",
  "1BR": "1BR",
  "2BR": "2BR",
  "3BR": "3BR",
  "4BR": "4BR",
  Penthouse: "penthouse",
};

function midRange([lo, hi]: [number, number]): number {
  if (hi > 0 && lo > 0) return (lo + hi) / 2;
  if (lo > 0) return lo;
  if (hi > 0) return hi;
  return 0;
}

function heightTierFor(totalHeightM: number): { key: keyof ZoneClassRow["constructionAedPerSqftBua"]; label: string } {
  if (totalHeightM <= 15) return { key: "lowRise", label: "Low rise (≤ 15 m)" };
  if (totalHeightM <= 23) return { key: "midRise", label: "Mid rise (15–23 m)" };
  if (totalHeightM <= 90) return { key: "highRise", label: "High rise (23–90 m)" };
  if (totalHeightM <= 180) return { key: "superHigh", label: "Super high (> 90 m)" };
  if (totalHeightM <= 270) return { key: "superHigh180", label: "Tower (> 180 m)" };
  if (totalHeightM <= 360) return { key: "superHigh270", label: "Tower (> 270 m)" };
  return { key: "superHigh360min", label: "Super tall (> 360 m)" };
}

function pricePerM2ForTypology(t: Typology, classRow: ZoneClassRow): number {
  const key = TYPOLOGY_KEY_FOR_CATEGORY[t.category];
  if (!key) return 0;
  const aedPerSqft = midRange(classRow.salePriceAedPerSqft[key]);
  return aedPerSqft * SQFT_PER_M2;
}

/** Compute auto-fill values from the detected zone class. Used both inside
 *  `computeEconomic` and exposed to the UI so it can show placeholders. */
export function computeEconomicDefaults(
  project: Project,
  classRow: ZoneClassRow | null,
): EconomicDefaults {
  if (!classRow) {
    return { constructionRatePerBUA: 0, retailRevenue: 0, typologyPricing: {}, heightTierLabel: "" };
  }
  const totalHeightM = (project.numFloors ?? 0) * (project.floorHeight ?? 0);
  const tier = heightTierFor(totalHeightM);
  const rate = tier.key === "superHigh360min"
    ? classRow.constructionAedPerSqftBua.superHigh360min
    : midRange(classRow.constructionAedPerSqftBua[tier.key] as [number, number]);
  const constructionRatePerBUA = Number((rate * SQFT_PER_M2).toFixed(0));

  const typologyPricing: Record<string, number> = {};
  for (const t of project.typologies) {
    const price = pricePerM2ForTypology(t, classRow);
    if (price > 0) typologyPricing[t.id] = Number(price.toFixed(0));
  }

  return {
    constructionRatePerBUA,
    retailRevenue: 0,
    typologyPricing,
    heightTierLabel: tier.label,
  };
}

export function computeEconomic(project: Project): EconomicResult {
  const program = computeProgram(project);
  const cfg: EconomicConfig = project.economic ?? {};
  const currency = cfg.currency ?? "AED";

  const detectedClass = classForZone(project.zone, DEFAULT_ZONE_CLASSES);
  const classRow = detectedClass ? DEFAULT_ZONE_CLASSES[detectedClass] : null;
  const defaults = computeEconomicDefaults(project, classRow);

  // ---- Revenue ----
  const pricing = cfg.typologyPricing ?? {};
  const residentialBeforePct: TypologyRevenue[] = program.byTypology
    .filter((ts) => ts.totalUnits > 0)
    .map((ts) => {
      const manual = Number(pricing[ts.typology.id] ?? 0);
      const auto = defaults.typologyPricing[ts.typology.id] ?? 0;
      const pricePerM2 = manual > 0 ? manual : auto;
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
        pricePerM2Auto: auto,
      };
    });
  const residentialRevenue = residentialBeforePct.reduce((s, r) => s + r.totalRevenue, 0);

  const parkingSpacesForSale = Math.max(0, cfg.parkingSpacesForSale ?? 0);
  const parkingPricePerSpace = Math.max(0, cfg.parkingPricePerSpace ?? 0);
  const parkingRevenue = parkingSpacesForSale * parkingPricePerSpace;

  const retailRevenue = Math.max(0, cfg.retailRevenue ?? 0);

  const totalRevenue = residentialRevenue + parkingRevenue + retailRevenue;

  const perTypologyRevenue = residentialBeforePct.map((r) => ({
    ...r,
    pctOfRevenue: totalRevenue > 0 ? r.totalRevenue / totalRevenue : 0,
  }));

  // ---- Costs ----
  const landCost = Math.max(0, cfg.landCost ?? 0);
  const manualRate = Math.max(0, cfg.constructionRatePerBUA ?? 0);
  const rate = manualRate > 0 ? manualRate : defaults.constructionRatePerBUA;
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
    { key: "construction", label: "Construction", amount: constructionCost, basis: `BUA × ${rate.toLocaleString()} ${currency}/m²${manualRate > 0 ? "" : " (auto)"}` },
    { key: "soft", label: "Soft costs (design / consultants)", amount: softCosts, basis: `${(softPct * 100).toFixed(1)}% of construction` },
    { key: "permits", label: "Permits & DM fees", amount: permitsCost, basis: `${(permitsPct * 100).toFixed(1)}% of construction` },
    { key: "contingency", label: "Contingency", amount: contingencyCost, basis: `${(contingencyPct * 100).toFixed(1)}% of (construction + soft)` },
    { key: "financing", label: "Financing during construction", amount: financingCost, basis: `${(financingPct * 100).toFixed(1)}% of construction` },
    { key: "marketing", label: "Marketing", amount: marketingCost, basis: `${(marketingPct * 100).toFixed(1)}% of GDV` },
    { key: "brokerage", label: "Sales / brokerage", amount: brokerageCost, basis: `${(brokeragePct * 100).toFixed(1)}% of GDV` },
  ];
  if (brandingFeePct > 0) {
    lines.push({ key: "branding", label: "Branding fee", amount: brandingFee, basis: `${(brandingFeePct * 100).toFixed(1)}% of GDV` });
  }
  const costs: CostLine[] = lines.map((l) => ({
    ...l,
    pctOfTotalCost: totalCost > 0 ? l.amount / totalCost : 0,
    pctOfRevenue: totalRevenue > 0 ? l.amount / totalRevenue : 0,
  }));

  // ---- Profit & UAE corporate tax (9% on profit above the exemption) ----
  const grossProfit = totalRevenue - totalCost;
  const corporateTaxRate = cfg.corporateTaxPct ?? DEFAULTS.corporateTaxPct;
  const corporateTaxExemption = Math.max(0, cfg.corporateTaxExemption ?? DEFAULTS.corporateTaxExemption);
  const taxable = Math.max(0, grossProfit - corporateTaxExemption);
  const corporateTax = taxable * corporateTaxRate;
  const profit = grossProfit - corporateTax;

  const grossMarginOnCost = totalCost > 0 ? grossProfit / totalCost : 0;
  const grossMarginOnGDV = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
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
    grossProfit,
    corporateTax,
    corporateTaxRate,
    corporateTaxExemption,
    profit,
    marginOnCost,
    marginOnGDV,
    grossMarginOnCost,
    grossMarginOnGDV,
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
    detectedClass,
    defaults,
  };
}
