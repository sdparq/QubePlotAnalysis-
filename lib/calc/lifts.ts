import type { Project } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";

export interface LiftsResult {
  byFloor: { floor: number; units: number; population: number }[];
  totalUnits: number;
  totalPopulation: number;
  demandStandard: number;
  demandPremium: number;
  personsPerTrip: number;
  totalTravelHeight: number;
  probableStops: number;
  rttSeconds: number;
  tripsPer5Min: number;
  capacityPerLift: number;
  liftsCIBSEStandard: number;
  liftsCIBSEPremium: number;
  liftsCIBSE: number;
  ruleOfThumbLifts: number;
  dcdMinLifts: number;
  liftsPractical: number;
  liftsRecommended: number;
  governing: string;
}

function roundTo(n: number, digits: number) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function computeLifts(project: Project): LiftsResult {
  const cfg = project.lifts;
  const std = DUBAI_STANDARDS.lifts;
  const tById = new Map(project.typologies.map((t) => [t.id, t]));

  const floors = Array.from({ length: project.numFloors }, (_, i) => i + 1);
  const byFloor = floors.map((floor) => {
    const cells = project.program.filter((c) => c.floor === floor);
    let units = 0,
      population = 0;
    for (const cell of cells) {
      const t = tById.get(cell.typologyId);
      if (!t || !cell.count) continue;
      units += cell.count;
      population += cell.count * t.occupancy;
    }
    return { floor, units, population };
  });

  const totalUnits = byFloor.reduce((s, f) => s + f.units, 0);
  const totalPopulation = byFloor.reduce((s, f) => s + f.population, 0);

  const demandStandard = Math.ceil(totalPopulation * cfg.handlingPctStandard);
  const demandPremium = Math.ceil(totalPopulation * cfg.handlingPctPremium);

  const personsPerTrip = Math.floor(Math.floor(cfg.cabinKg / std.weightPerPerson) * std.capacityFactor);

  const totalTravelHeight = project.numFloors * project.floorHeight;
  const probableStops = roundTo(Math.sqrt(project.numFloors), 1);
  const rttSeconds = roundTo((2 * totalTravelHeight) / cfg.speed + probableStops * cfg.timePerStop, 1);
  const tripsPer5Min = Math.floor((std.handlingWindowSec / rttSeconds) * 10) / 10;
  const capacityPerLift = Math.floor(tripsPer5Min * personsPerTrip);

  const liftsCIBSEStandard = capacityPerLift > 0 ? Math.ceil(demandStandard / capacityPerLift) : 0;
  const liftsCIBSEPremium = capacityPerLift > 0 ? Math.ceil(demandPremium / capacityPerLift) : 0;
  const liftsCIBSE = Math.max(liftsCIBSEStandard, liftsCIBSEPremium);

  const ruleOfThumbLifts = Math.ceil(totalUnits / cfg.unitsPerLiftRule);
  const dcdMinLifts = totalUnits >= cfg.dcdMinUnitsThreshold ? cfg.dcdMinLifts : 0;
  const liftsPractical = Math.max(ruleOfThumbLifts, dcdMinLifts);
  const liftsRecommended = Math.max(liftsCIBSE, liftsPractical);

  let governing: string;
  if (liftsRecommended === liftsPractical && liftsPractical > liftsCIBSE) {
    if (liftsPractical === ruleOfThumbLifts) governing = `Rule of thumb (1 per ${cfg.unitsPerLiftRule} units)`;
    else governing = "DCD minimum";
  } else {
    governing = liftsCIBSEPremium >= liftsCIBSEStandard ? "CIBSE premium 7%" : "CIBSE standard 5%";
  }

  return {
    byFloor,
    totalUnits,
    totalPopulation,
    demandStandard,
    demandPremium,
    personsPerTrip,
    totalTravelHeight,
    probableStops,
    rttSeconds,
    tripsPer5Min,
    capacityPerLift,
    liftsCIBSEStandard,
    liftsCIBSEPremium,
    liftsCIBSE,
    ruleOfThumbLifts,
    dcdMinLifts,
    liftsPractical,
    liftsRecommended,
    governing,
  };
}
