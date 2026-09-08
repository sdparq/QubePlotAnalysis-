import type { Project, Typology } from "../types";
import { deriveCommonAreas } from "./common-areas";
import { balconyGfaFactor } from "./balcony";

export interface FloorSummary {
  floor: number;
  units: number;
  totalBalcony: number;
  totalSellable: number;
  totalInteriorGFA: number;
  /** GFA consumed: interior + the counted balcony share. */
  totalGFA: number;
}

export interface TypologySummary {
  typology: Typology;
  totalUnits: number;
  totalInteriorGFA: number;
  totalBalcony: number;
  totalSellable: number;
  /** GFA consumed: interior + the counted balcony share. */
  totalGFA: number;
  pctOfTotal: number;
}

export interface ProgramResult {
  totalUnits: number;
  totalInteriorGFA: number;
  totalBalcony: number;
  /** Share (0 / 0.5 / 1) of the balconies that counts as GFA — Typologies. */
  balconyGfaFactor: number;
  /** totalBalcony × balconyGfaFactor. */
  totalBalconyGFA: number;
  /** GFA the placed units consume = interior + counted balconies. This is
   *  what the Apartments GFA target from Distribution is compared against. */
  totalApartmentsGFA: number;
  totalSellable: number;
  shaftsDeduction: number;
  commonAreasGFA: number;
  commonAreasBUAonly: number;
  commonAreasOpen: number;
  /** @deprecated kept for backwards compatibility — = commonAreasBUAonly + commonAreasOpen */
  commonAreasNonGFA: number;
  totalGFABuilding: number;
  totalBUABuilding: number;
  byFloor: FloorSummary[];
  byTypology: TypologySummary[];
  unitsByCategory: Record<string, number>;
  efficiency: {
    residentialNetGFA: number;
    residentialNetPct: number;
    circulationGFA: number;
    circulationPct: number;
    servicesGFA: number;
    servicesPct: number;
    amenitiesGFAarea: number;
    amenitiesPct: number;
    amenitiesNonGFA: number;
    balconiesNonGFA: number;
  };
  far: number;
}

export function computeProgram(project: Project): ProgramResult {
  const tById = new Map(project.typologies.map((t) => [t.id, t]));
  const bf = balconyGfaFactor(project);

  // Only consider cells whose floor is within the project's current floor range.
  // Stale cells (left over after numFloors was reduced) must not contribute to any total.
  const activeCells = project.program.filter((c) => c.floor >= 1 && c.floor <= project.numFloors);

  const floors = Array.from({ length: project.numFloors }, (_, i) => i + 1);
  const byFloor: FloorSummary[] = floors.map((floor) => {
    const cells = activeCells.filter((c) => c.floor === floor);
    let units = 0,
      totalBalcony = 0,
      totalSellable = 0,
      totalInteriorGFA = 0;
    for (const cell of cells) {
      const t = tById.get(cell.typologyId);
      if (!t || !cell.count) continue;
      units += cell.count;
      totalBalcony += cell.count * t.balconyArea;
      totalInteriorGFA += cell.count * t.internalArea;
      totalSellable += cell.count * (t.internalArea + t.balconyArea);
    }
    return {
      floor,
      units,
      totalBalcony,
      totalSellable,
      totalInteriorGFA,
      totalGFA: totalInteriorGFA + bf * totalBalcony,
    };
  });

  const totalUnits = byFloor.reduce((s, f) => s + f.units, 0);
  const totalInteriorGFA = byFloor.reduce((s, f) => s + f.totalInteriorGFA, 0);
  const totalBalcony = byFloor.reduce((s, f) => s + f.totalBalcony, 0);
  const totalSellable = byFloor.reduce((s, f) => s + f.totalSellable, 0);
  const totalBalconyGFA = bf * totalBalcony;
  const totalApartmentsGFA = totalInteriorGFA + totalBalconyGFA;

  const byTypology: TypologySummary[] = project.typologies.map((t) => {
    const totalUnitsT = activeCells
      .filter((c) => c.typologyId === t.id)
      .reduce((s, c) => s + c.count, 0);
    return {
      typology: t,
      totalUnits: totalUnitsT,
      totalInteriorGFA: totalUnitsT * t.internalArea,
      totalBalcony: totalUnitsT * t.balconyArea,
      totalSellable: totalUnitsT * (t.internalArea + t.balconyArea),
      totalGFA: totalUnitsT * (t.internalArea + bf * t.balconyArea),
      pctOfTotal: totalUnits > 0 ? totalUnitsT / totalUnits : 0,
    };
  });

  const unitsByCategory: Record<string, number> = {};
  for (const ts of byTypology) {
    unitsByCategory[ts.typology.category] = (unitsByCategory[ts.typology.category] || 0) + ts.totalUnits;
  }

  const shaftsDeduction = totalUnits * project.shaftPerUnit;

  // Common areas are derived live from the Distribution percentages (new
  // model) or summed from the persisted row list (legacy projects) — see
  // deriveCommonAreas. Deriving live means the totals can never go stale when
  // Setup (Target GFA / residential share) changes after the last
  // Distribution edit.
  const derived = deriveCommonAreas(project);
  const commonAreasGFA = derived.commonAreasGFA;
  const commonAreasBUAonly = derived.commonAreasBUAonly;
  const commonAreasOpen = derived.commonAreasOpen;
  const commonAreasNonGFA = commonAreasBUAonly + commonAreasOpen;

  const totalGFABuilding = totalApartmentsGFA + commonAreasGFA - shaftsDeduction;
  // BUA = unit interiors + balconies (already inside the unit envelope) + every common area that
  // forms part of the built envelope (GFA-counting + shafts/MEP/lift/parking style spaces). Open-air
  // amenities are not counted.
  const totalBUABuilding = totalInteriorGFA + totalBalcony + commonAreasGFA + commonAreasBUAonly;

  const circulationGFA = derived.circulationGFA;
  // In the Distribution model services is BUA-only — reported here as its BUA
  // value so exports and dashboards still show the MEP/shafts allowance.
  const servicesGFA = derived.servicesArea;
  const amenitiesGFAarea = derived.amenitiesGFA;

  const residentialNetGFA = totalApartmentsGFA - shaftsDeduction;
  const denom = totalGFABuilding || 1;

  return {
    totalUnits,
    totalInteriorGFA,
    totalBalcony,
    balconyGfaFactor: bf,
    totalBalconyGFA,
    totalApartmentsGFA,
    totalSellable,
    shaftsDeduction,
    commonAreasGFA,
    commonAreasBUAonly,
    commonAreasOpen,
    commonAreasNonGFA,
    totalGFABuilding,
    totalBUABuilding,
    byFloor,
    byTypology,
    unitsByCategory,
    efficiency: {
      residentialNetGFA,
      residentialNetPct: residentialNetGFA / denom,
      circulationGFA,
      circulationPct: circulationGFA / denom,
      servicesGFA,
      servicesPct: servicesGFA / denom,
      amenitiesGFAarea,
      amenitiesPct: amenitiesGFAarea / denom,
      amenitiesNonGFA: commonAreasOpen,
      balconiesNonGFA: totalBalcony - totalBalconyGFA,
    },
    far: project.plotArea > 0 ? totalGFABuilding / project.plotArea : 0,
  };
}
