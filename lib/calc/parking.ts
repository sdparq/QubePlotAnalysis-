import type { Project } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";

export interface ParkingResult {
  availableStandard: number;
  availablePRM: number;
  availableTotal: number;
  byLevel: { name: string; standard: number; prm: number; total: number }[];
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

  const unitCounts: Record<string, number> = {};
  const tById = new Map(project.typologies.map((t) => [t.id, t]));
  for (const cell of project.program) {
    const t = tById.get(cell.typologyId);
    if (!t || !cell.count) continue;
    unitCounts[t.category] = (unitCounts[t.category] || 0) + cell.count;
  }

  const ratios = DUBAI_STANDARDS.parking.ratiosByCategory as Record<string, number>;
  const requiredByCategory = Object.entries(unitCounts).map(([category, units]) => {
    const tForCategory = project.typologies.find((t) => t.category === category);
    const ratio = tForCategory?.parkingPerUnit ?? ratios[category] ?? 1;
    return { category, units, ratio, required: units * ratio };
  });

  const totalUnitsCounted = Object.values(unitCounts).reduce((s, v) => s + v, 0);
  const requiredTotal = requiredByCategory.reduce((s, r) => s + r.required, 0);

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
