import type { Project } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";

/* -------------------------------------------------------------------------- */
/*    Dubai Building Code D.8.8 — Passenger elevators in residential apts.   */
/* -------------------------------------------------------------------------- */

/** Figure D.13 — minimum lifts by population (rows) × occupied floors (cols).
 *  null = "blank" in the chart (out of range → VT consultant required). */
const D13_FLOOR_BRACKETS: [number, number][] = [
  [1, 5],
  [6, 10],
  [11, 15],
  [16, 20],
  [21, 25],
  [26, 30],
  [31, 35],
];
const D13_POP_BRACKETS: [number, number][] = [
  [0, 200],
  [201, 300],
  [301, 400],
  [401, 500],
  [501, 600],
  [601, 700],
  [701, 800],
  [801, 900],
  [901, 1000],
  [1001, 1200],
];
// Rows aligned with D13_FLOOR_BRACKETS, cols with D13_POP_BRACKETS.
const D13_TABLE: (number | null)[][] = [
  [   1,    1,    2,    2, null, null, null, null, null, null], //  1- 5
  [   2,    2,    2,    2,    3,    3,    3, null, null, null], //  6-10
  [   2,    2,    2,    3,    3,    3,    4,    4,    4,    5], // 11-15
  [   2,    3,    3,    3,    3,    4,    4,    4,    5,    5], // 16-20
  [   2,    3,    3,    3,    4,    4,    4,    5,    5,    6], // 21-25
  [   3,    3,    3,    3,    4,    4,    5,    5,    5,    6], // 26-30
  [null,    3,    3,    4,    4,    5,    5,    5,    6,    6], // 31-35
];

/** Figure D.14 — additional lifts by boarding floors. Two sub-charts depending
 *  on whether population > 700 or ≤ 700. Blanks → out of range. */
const D14_BOARDING_BRACKETS = [1, 2, 3, 4, 5, 6];
const D14_TABLE_HIGH_POP: (number | null)[][] = [
  // 1   2   3   4   5   6
  [  0,  0,  0, null, null, null], //  1- 5
  [  0,  0,  0,  1, null, null],   //  6-10
  [  0,  0,  0,  1,  1,  1],       // 11-15
  [  0,  0,  1,  1,  1,  1],       // 16-20
  [  0,  0,  1,  1,  1,  1],       // 21-25
  [  0,  0,  1,  1,  2,  2],       // 26-30
  [  0,  0,  1,  1,  2,  2],       // 31-35
];
const D14_TABLE_LOW_POP: (number | null)[][] = [
  // 1   2   3   4   5   6
  [  0,  0,  0, null, null, null], //  1- 5
  [  0,  0,  0,  1, null, null],   //  6-10
  [  0,  0,  0,  1,  1,  1],       // 11-15
  [  0,  0,  1,  1,  1,  1],       // 16-20
  [  0,  0,  1,  1,  1,  1],       // 21-25
  [  0,  0,  1,  1,  1,  1],       // 26-30
  [  0,  0,  1,  1,  1,  1],       // 31-35
];

function rangeIndex(value: number, brackets: [number, number][]): number {
  for (let i = 0; i < brackets.length; i++) {
    const [lo, hi] = brackets[i];
    if (value >= lo && value <= hi) return i;
  }
  // Beyond the chart — fall back to the highest bracket.
  if (value > brackets[brackets.length - 1][1]) return brackets.length - 1;
  return -1;
}

function boardingIndex(boarding: number): number {
  if (boarding <= 0) return -1;
  if (boarding >= D14_BOARDING_BRACKETS[D14_BOARDING_BRACKETS.length - 1]) return D14_BOARDING_BRACKETS.length - 1;
  return boarding - 1;
}

export interface DBCLiftLookup {
  fromPopulation: number | null;
  fromBoarding: number | null;
  total: number | null;
  outOfChart: boolean;
  beyondChart: boolean;     // outside the highest bracket
  populationBracketIdx: number;
  floorBracketIdx: number;
  boardingBracketIdx: number;
}

export function dbcResidentialLifts(opts: {
  population: number;
  occupiedFloors: number;
  boardingFloors: number;
}): DBCLiftLookup {
  const { population, occupiedFloors, boardingFloors } = opts;

  const fIdx = rangeIndex(occupiedFloors, D13_FLOOR_BRACKETS);
  const pIdx = rangeIndex(population, D13_POP_BRACKETS);
  const bIdx = boardingIndex(boardingFloors);

  const fromPopulation = fIdx >= 0 && pIdx >= 0 ? D13_TABLE[fIdx][pIdx] : null;
  const d14Table = population > 700 ? D14_TABLE_HIGH_POP : D14_TABLE_LOW_POP;
  const fromBoarding = fIdx >= 0 && bIdx >= 0 ? d14Table[fIdx][bIdx] : null;

  const outOfChart = fromPopulation === null || fromBoarding === null;
  const beyondChart =
    occupiedFloors > D13_FLOOR_BRACKETS[D13_FLOOR_BRACKETS.length - 1][1] ||
    population > D13_POP_BRACKETS[D13_POP_BRACKETS.length - 1][1] ||
    boardingFloors > D14_BOARDING_BRACKETS[D14_BOARDING_BRACKETS.length - 1];

  const total =
    fromPopulation !== null && fromBoarding !== null
      ? fromPopulation + fromBoarding
      : null;

  return {
    fromPopulation,
    fromBoarding,
    total,
    outOfChart,
    beyondChart,
    populationBracketIdx: pIdx,
    floorBracketIdx: fIdx,
    boardingBracketIdx: bIdx,
  };
}

/** Table D.6 — minimum / recommended elevator specifications. */
export interface MinLiftSpec {
  ratedKg: number;
  persons: number;
  cabinW_mm: number;
  cabinD_mm: number;
  cabinH_mm: number;
  doorW_mm: number;
  doorH_mm: number;
  doorType: string;
  category: "min" | "recommended";
  description: string;
}

export function minPassengerLiftSpec(occupiedFloors: number, recommended = false): MinLiftSpec {
  if (occupiedFloors <= 10) {
    return {
      ratedKg: 750,
      persons: 10,
      cabinW_mm: 1200,
      cabinD_mm: 1500,
      cabinH_mm: 2300,
      doorW_mm: 900,
      doorH_mm: 2100,
      doorType: "Two-panel centre opening",
      category: "min",
      description: "Min for floors ≤ 10",
    };
  }
  if (recommended) {
    return {
      ratedKg: 1350,
      persons: 18,
      cabinW_mm: 2000,
      cabinD_mm: 1500,
      cabinH_mm: 2300,
      doorW_mm: 1100,
      doorH_mm: 2100,
      doorType: "Two-panel centre opening",
      category: "recommended",
      description: "Recommended for floors > 10",
    };
  }
  return {
    ratedKg: 1050,
    persons: 14,
    cabinW_mm: 1600,
    cabinD_mm: 1500,
    cabinH_mm: 2300,
    doorW_mm: 1100,
    doorH_mm: 2100,
    doorType: "Two-panel centre opening",
    category: "min",
    description: "Min for floors > 10",
  };
}

export function minServiceLiftSpec(recommended = false): MinLiftSpec {
  if (recommended) {
    return {
      ratedKg: 1600,
      persons: 21,
      cabinW_mm: 1400,
      cabinD_mm: 2400,
      cabinH_mm: 2500,
      doorW_mm: 1200,
      doorH_mm: 2100,
      doorType: "Two-panel centre opening",
      category: "recommended",
      description: "Recommended service elevator",
    };
  }
  return {
    ratedKg: 1275,
    persons: 17,
    cabinW_mm: 1200,
    cabinD_mm: 2300,
    cabinH_mm: 2500,
    doorW_mm: 1100,
    doorH_mm: 2100,
    doorType: "Two-panel centre opening",
    category: "min",
    description: "Min service elevator",
  };
}

/* -------------------------------------------------------------------------- */
/*                              CIBSE / project calc                          */
/* -------------------------------------------------------------------------- */

export interface LiftsResult {
  byFloor: { floor: number; units: number; population: number }[];
  totalUnits: number;
  totalPopulation: number;
  // CIBSE Guide D round-trip-time path
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
  /** Dubai Building Code D.8.8 minimum (sum of D.13 + D.14). Kept under this
   *  name for backward-compatibility with previous result shape. */
  dcdMinLifts: number;
  // Dubai Building Code D.8.8 path
  occupiedFloors: number;
  boardingFloors: number;
  dbcFromPopulation: number | null;
  dbcFromBoarding: number | null;
  dbcTotal: number | null;
  dbcOutOfChart: boolean;
  dbcBeyondChart: boolean;
  // Combined recommendation
  liftsRecommended: number;
  governing: string;
  // Cabin guidance (Table D.6)
  passengerMin: MinLiftSpec;
  passengerRecommended: MinLiftSpec;
  serviceMin: MinLiftSpec;
  serviceRecommended: MinLiftSpec;
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

  // CIBSE handling-capacity computation
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

  // Dubai Building Code D.8.8 path
  const occupiedFloors = project.numFloors; // residential type floors
  const basementCount = project.basements?.count ?? 0;
  const groundCount = project.ground?.count ?? 1;
  const podiumCount = project.podium?.count ?? 0;
  const defaultBoardingFloors = basementCount + groundCount + podiumCount;
  const boardingFloors = project.dbcBoardingFloors ?? Math.max(1, defaultBoardingFloors);

  const dbc = dbcResidentialLifts({
    population: Math.round(totalPopulation),
    occupiedFloors,
    boardingFloors,
  });

  const candidates: { count: number; label: string }[] = [
    { count: liftsCIBSE, label: liftsCIBSEPremium >= liftsCIBSEStandard ? "CIBSE premium 7%" : "CIBSE standard 5%" },
    { count: ruleOfThumbLifts, label: `Rule of thumb (1 per ${cfg.unitsPerLiftRule} units)` },
    { count: dbc.total ?? 0, label: "Dubai Building Code D.8.8" },
  ];
  candidates.sort((a, b) => b.count - a.count);
  const top = candidates[0];
  const liftsRecommended = top.count;
  const governing = dbc.outOfChart && dbc.total === null
    ? "Out of D.8.8 chart — VT Consultant required (D.9 method 2)"
    : top.label;

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
    dcdMinLifts: dbc.total ?? 0,
    occupiedFloors,
    boardingFloors,
    dbcFromPopulation: dbc.fromPopulation,
    dbcFromBoarding: dbc.fromBoarding,
    dbcTotal: dbc.total,
    dbcOutOfChart: dbc.outOfChart,
    dbcBeyondChart: dbc.beyondChart,
    liftsRecommended,
    governing,
    passengerMin: minPassengerLiftSpec(occupiedFloors, false),
    passengerRecommended: minPassengerLiftSpec(occupiedFloors, true),
    serviceMin: minServiceLiftSpec(false),
    serviceRecommended: minServiceLiftSpec(true),
  };
}
