import type { Project, Typology } from "../types";
import { effectiveTargetGFA } from "./gfa";

export interface ParkingResult {
  availableStandard: number;
  availablePRM: number;
  availableTotal: number;
  byLevel: { name: string; standard: number; prm: number; total: number }[];
  /** Per-typology breakdown — each row uses the typology's own parkingPerUnit */
  requiredByTypology: { typology: Typology; units: number; ratio: number; required: number }[];
  /** Aggregated by category for high-level summary (sums up the per-typology values) */
  requiredByCategory: { category: string; units: number; ratio: number; required: number }[];
  totalUnitsCounted: number;
  requiredTotal: number;
  requiredPRM: number;
  prmBalance: number;
  balance: number;
  otherUsesRequired: { name: string; netArea: number; ratio: number; required: number }[];
  otherUsesTotal: number;
  /** Retail parking auto-derived from Setup's GFA breakdown (retail m² / rate). */
  retailRequired: number;
  retailM2PerSpaceUsed: number;
  retailM2: number;
  grandRequired: number;
  grandBalance: number;
  /** Total parking surface needed (m²) — `grandRequired × m²/space`. */
  totalParkingSurfaceM2: number;
  m2PerParkingSpaceUsed: number;
}

/**
 * Dubai DCD accessible-parking tiered rule (QUBE matrix):
 *   < 25 total       → no minimum
 *   25 – 500 total   → 2% of total, minimum of one
 *   > 500 total      → 2% on first 500 + 1% on the rest (= 10 + 1% × (total − 500))
 */
export function requiredPRM(totalRequired: number): number {
  if (totalRequired < 25) return 0;
  if (totalRequired <= 500) return Math.max(1, Math.ceil(totalRequired * 0.02));
  return Math.ceil(500 * 0.02) + Math.ceil((totalRequired - 500) * 0.01);
}

/** Retail GFA (m²) drawn from Setup's GFA breakdown — the single source of
 *  truth for retail area. */
function retailGFA(project: Project): number {
  const item = project.gfaBreakdown?.retail;
  if (!item) return 0;
  const target = effectiveTargetGFA(project);
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

export function computeParking(project: Project): ParkingResult {
  const byLevel = project.parking.map((p) => ({
    name: p.name,
    standard: p.standard,
    prm: p.prm,
    total: p.standard + p.prm,
  }));
  const availableStandard = byLevel.reduce((s, l) => s + l.standard, 0);
  const availablePRM = byLevel.reduce((s, l) => s + l.prm, 0);
  const availableTotal = availableStandard + availablePRM;

  // Active program cells only (within current floor range)
  const activeCells = project.program.filter(
    (c) => c.floor >= 1 && c.floor <= project.numFloors
  );

  // Sum units per typology id
  const unitsByTypology = new Map<string, number>();
  const tById = new Map(project.typologies.map((t) => [t.id, t]));
  for (const cell of activeCells) {
    if (!tById.has(cell.typologyId) || !cell.count) continue;
    unitsByTypology.set(cell.typologyId, (unitsByTypology.get(cell.typologyId) || 0) + cell.count);
  }

  // Per-typology required (uses each typology's own parkingPerUnit)
  const requiredByTypology = project.typologies
    .map((t) => {
      const units = unitsByTypology.get(t.id) || 0;
      return { typology: t, units, ratio: t.parkingPerUnit, required: units * t.parkingPerUnit };
    })
    .filter((r) => r.units > 0);

  // Aggregate by category from the per-typology rows
  const catMap = new Map<string, { units: number; required: number }>();
  for (const r of requiredByTypology) {
    const cat = r.typology.category;
    const prev = catMap.get(cat) ?? { units: 0, required: 0 };
    catMap.set(cat, { units: prev.units + r.units, required: prev.required + r.required });
  }
  const requiredByCategory = Array.from(catMap.entries()).map(([category, v]) => ({
    category,
    units: v.units,
    ratio: v.units > 0 ? v.required / v.units : 0, // weighted average ratio
    required: v.required,
  }));

  const totalUnitsCounted = requiredByTypology.reduce((s, r) => s + r.units, 0);
  const requiredTotal = requiredByTypology.reduce((s, r) => s + r.required, 0);

  const otherUsesRequired = project.otherUses.map((u) => ({
    name: u.name,
    netArea: u.netArea,
    ratio: u.spacesPer100sqm,
    required: (u.netArea * u.spacesPer100sqm) / 100,
  }));
  const otherUsesTotal = otherUsesRequired.reduce((s, r) => s + r.required, 0);

  const retailM2 = retailGFA(project);
  const retailM2PerSpaceUsed = project.retailM2PerSpace ?? 70;
  const retailRequired = retailM2PerSpaceUsed > 0
    ? Math.ceil(retailM2 / retailM2PerSpaceUsed)
    : 0;

  const grandRequired = requiredTotal + otherUsesTotal + retailRequired;
  const m2PerParkingSpaceUsed = project.m2PerParkingSpace ?? 25;
  const totalParkingSurfaceM2 = grandRequired * m2PerParkingSpaceUsed;

  return {
    availableStandard,
    availablePRM,
    availableTotal,
    byLevel,
    requiredByTypology,
    requiredByCategory,
    totalUnitsCounted,
    requiredTotal,
    requiredPRM: requiredPRM(grandRequired),
    prmBalance: availablePRM - requiredPRM(grandRequired),
    balance: availableTotal - requiredTotal,
    otherUsesRequired,
    otherUsesTotal,
    retailRequired,
    retailM2PerSpaceUsed,
    retailM2,
    grandRequired,
    grandBalance: availableTotal - grandRequired,
    totalParkingSurfaceM2,
    m2PerParkingSpaceUsed,
  };
}

