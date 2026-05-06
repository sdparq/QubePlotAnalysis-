import type { Project, Typology } from "../types";
import { commonAreaCategory, effectiveCommonAreaTotal } from "../types";

export interface FloorSummary {
  floor: number;
  units: number;
  totalBalcony: number;
  totalSellable: number;
  totalInteriorGFA: number;
}

export interface TypologySummary {
  typology: Typology;
  totalUnits: number;
  totalInteriorGFA: number;
  totalBalcony: number;
  totalSellable: number;
  pctOfTotal: number;
}

export interface ProgramResult {
  totalUnits: number;
  totalInteriorGFA: number;
  totalBalcony: number;
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
    return { floor, units, totalBalcony, totalSellable, totalInteriorGFA };
  });

  const totalUnits = byFloor.reduce((s, f) => s + f.units, 0);
  const totalInteriorGFA = byFloor.reduce((s, f) => s + f.totalInteriorGFA, 0);
  const totalBalcony = byFloor.reduce((s, f) => s + f.totalBalcony, 0);
  const totalSellable = byFloor.reduce((s, f) => s + f.totalSellable, 0);

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
      pctOfTotal: totalUnits > 0 ? totalUnitsT / totalUnits : 0,
    };
  });

  const unitsByCategory: Record<string, number> = {};
  for (const ts of byTypology) {
    unitsByCategory[ts.typology.category] = (unitsByCategory[ts.typology.category] || 0) + ts.totalUnits;
  }

  const shaftsDeduction = totalUnits * project.shaftPerUnit;

  let commonAreasGFA = 0;
  let commonAreasBUAonly = 0;
  let commonAreasOpen = 0;
  for (const c of project.commonAreas) {
    const total = effectiveCommonAreaTotal(c, project);
    const cat = commonAreaCategory(c);
    if (cat === "GFA") commonAreasGFA += total;
    else if (cat === "BUA") commonAreasBUAonly += total;
    else commonAreasOpen += total;
  }
  const commonAreasNonGFA = commonAreasBUAonly + commonAreasOpen;

  const totalGFABuilding = totalInteriorGFA + commonAreasGFA - shaftsDeduction;
  // BUA = unit interiors + balconies (already inside the unit envelope) + every common area that
  // forms part of the built envelope (GFA-counting + shafts/MEP/lift/parking style spaces). Open-air
  // amenities are not counted.
  const totalBUABuilding = totalInteriorGFA + totalBalcony + commonAreasGFA + commonAreasBUAonly;

  const circulationKeywords = /lobby|corridor|stair|lift/i;
  const servicesKeywords = /mep|service|pump|electric/i;

  let circulationGFA = 0;
  let servicesGFA = 0;
  let amenitiesGFAarea = 0;
  for (const c of project.commonAreas) {
    if (commonAreaCategory(c) !== "GFA") continue;
    const total = effectiveCommonAreaTotal(c, project);
    if (circulationKeywords.test(c.name)) circulationGFA += total;
    else if (servicesKeywords.test(c.name)) servicesGFA += total;
    else amenitiesGFAarea += total;
  }

  const residentialNetGFA = totalInteriorGFA - shaftsDeduction;
  const denom = totalGFABuilding || 1;

  return {
    totalUnits,
    totalInteriorGFA,
    totalBalcony,
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
      balconiesNonGFA: totalBalcony,
    },
    far: project.plotArea > 0 ? totalGFABuilding / project.plotArea : 0,
  };
}
