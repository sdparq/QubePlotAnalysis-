import type { Project, Typology } from "../types";

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
  commonAreasNonGFA: number;
  totalGFABuilding: number;
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

  const floors = Array.from({ length: project.numFloors }, (_, i) => i + 1);
  const byFloor: FloorSummary[] = floors.map((floor) => {
    const cells = project.program.filter((c) => c.floor === floor);
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
    const totalUnitsT = project.program
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
  const commonAreasGFA = project.commonAreas
    .filter((c) => c.countAsGFA)
    .reduce((s, c) => s + c.area * c.floors, 0);
  const commonAreasNonGFA = project.commonAreas
    .filter((c) => !c.countAsGFA)
    .reduce((s, c) => s + c.area * c.floors, 0);

  const totalGFABuilding = totalInteriorGFA + commonAreasGFA - shaftsDeduction;

  const circulationKeywords = /lobby|corridor|stair|lift/i;
  const servicesKeywords = /mep|service|pump|electric/i;

  let circulationGFA = 0;
  let servicesGFA = 0;
  let amenitiesGFAarea = 0;
  for (const c of project.commonAreas) {
    const total = c.area * c.floors;
    if (!c.countAsGFA) continue;
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
    commonAreasNonGFA,
    totalGFABuilding,
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
      amenitiesNonGFA: commonAreasNonGFA,
      balconiesNonGFA: totalBalcony,
    },
    far: project.plotArea > 0 ? totalGFABuilding / project.plotArea : 0,
  };
}
