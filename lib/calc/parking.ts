import type { Project, Typology } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";

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
  grandRequired: number;
  grandBalance: number;
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

  const grandRequired = requiredTotal + otherUsesTotal;

  const requiredPRM = Math.ceil(grandRequired * (project.prmPercent || DUBAI_STANDARDS.parking.prmPercent));

  return {
    availableStandard,
    availablePRM,
    availableTotal,
    byLevel,
    requiredByTypology,
    requiredByCategory,
    totalUnitsCounted,
    requiredTotal,
    requiredPRM,
    prmBalance: availablePRM - requiredPRM,
    balance: availableTotal - requiredTotal,
    otherUsesRequired,
    otherUsesTotal,
    grandRequired,
    grandBalance: availableTotal - grandRequired,
  };
}
