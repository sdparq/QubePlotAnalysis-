import type { Project } from "../types";

/**
 * Commercial / Office use, distributed like the residential GFA:
 *
 *   office GFA (Setup → GFA breakdown → Commercial / Office)
 *     − circulation  (cores, lobbies, corridors)      % of office GFA
 *     − services     (MEP, shafts, toilets, plant)    % of office GFA
 *     = net lettable offices  →  office GSA (no balconies)
 *
 * Circulation and services both sit inside the office GFA here, so the
 * office BUA equals its GFA. Parking: 1 space per `officeM2PerSpace` m² of
 * office GSA (default 50).
 */
export const DEFAULT_OFFICE_BREAKDOWN = { circulationPct: 12, servicesPct: 6 } as const;
export const DEFAULT_OFFICE_M2_PER_SPACE = 50;

export interface OfficeResult {
  officeGFA: number;
  circulationPct: number;
  servicesPct: number;
  /** 100 − circulation − services, floored at 0. */
  netPct: number;
  circulation: number;
  services: number;
  /** Net lettable office area — the office GSA. */
  net: number;
  m2PerSpace: number;
  parkingRequired: number;
}

/** Office GFA (m²) from Setup's GFA breakdown. */
export function officeGFA(project: Project): number {
  const item = project.gfaBreakdown?.commercial;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return Math.max(0, item.mode === "absolute" ? item.value : (item.value / 100) * target);
}

export function computeOffices(project: Project): OfficeResult {
  const gfa = officeGFA(project);
  const ob = project.officeBreakdown ?? {};
  const circulationPct = Math.max(0, ob.circulationPct ?? DEFAULT_OFFICE_BREAKDOWN.circulationPct);
  const servicesPct = Math.max(0, ob.servicesPct ?? DEFAULT_OFFICE_BREAKDOWN.servicesPct);
  const netPct = Math.max(0, 100 - circulationPct - servicesPct);
  const net = (gfa * netPct) / 100;
  const m2PerSpace = project.officeM2PerSpace ?? DEFAULT_OFFICE_M2_PER_SPACE;
  return {
    officeGFA: gfa,
    circulationPct,
    servicesPct,
    netPct,
    circulation: (gfa * circulationPct) / 100,
    services: (gfa * servicesPct) / 100,
    net,
    m2PerSpace,
    parkingRequired: m2PerSpace > 0 && net > 0 ? Math.ceil(net / m2PerSpace) : 0,
  };
}

export const DEFAULT_OFFICE_FLOOR_HEIGHT = 4.0;

export interface OfficeStackResult {
  /** Podium levels (1-based, sorted) given to offices, within the podium count. */
  podiumLevels: number[];
  /** Office GFA on those podium levels = podium footprint × levels. */
  podiumGFA: number;
  /** Office GFA still to place in the tower. */
  remainingGFA: number;
  /** remainingGFA ÷ tower footprint, rounded up (0 without a footprint). */
  autoTowerFloors: number;
  /** Tower floors given to offices (manual value, else the automatic one). */
  towerFloors: number;
  manualTowerFloors: boolean;
  towerPosition: "bottom" | "top";
  heightM: number;
  towerGFA: number;
  /** Office GFA placed in podium + tower minus the office GFA (− short, + spare). */
  placementDrift: number;
  /** The tower footprint is missing in Distribution, so floors can't be derived. */
  needsTowerFootprint: boolean;
}

export function computeOfficeStack(project: Project): OfficeStackResult {
  const s = project.officeStack ?? {};
  const gfa = officeGFA(project);
  const podiumCount = Math.max(0, project.podium?.count ?? 0);
  const podiumLevels = Array.from(new Set(s.podiumLevels ?? []))
    .filter((l) => Number.isInteger(l) && l >= 1 && l <= podiumCount)
    .sort((a, b) => a - b);
  const podiumFootprint = Math.max(0, project.podiumFootprintM2 ?? 0);
  const towerFootprint = Math.max(0, project.towerFootprintM2 ?? 0);
  const podiumGFA = gfa > 0 ? podiumFootprint * podiumLevels.length : 0;
  const remainingGFA = Math.max(0, gfa - podiumGFA);
  const autoTowerFloors =
    gfa > 0 && towerFootprint > 0 ? Math.ceil(remainingGFA / towerFootprint - 1e-9) : 0;
  const manualTowerFloors = s.towerFloors !== undefined && Number.isFinite(s.towerFloors) && s.towerFloors >= 0;
  const towerFloors = gfa > 0 ? (manualTowerFloors ? Math.round(s.towerFloors as number) : autoTowerFloors) : 0;
  const towerGFA = towerFootprint * towerFloors;
  return {
    podiumLevels: gfa > 0 ? podiumLevels : [],
    podiumGFA,
    remainingGFA,
    autoTowerFloors,
    towerFloors,
    manualTowerFloors,
    towerPosition: s.towerPosition ?? "bottom",
    heightM: s.heightM && s.heightM > 0 ? s.heightM : DEFAULT_OFFICE_FLOOR_HEIGHT,
    towerGFA,
    placementDrift: gfa > 0 ? podiumGFA + towerGFA - gfa : 0,
    needsTowerFootprint: gfa > 0 && remainingGFA > 0 && towerFootprint <= 0 && !manualTowerFloors,
  };
}

/** The tower as built: residential type floors (the Apartments matrix) plus
 *  any office floors stacked on them. Single source for heights, storey
 *  codes and lift travel. */
export function towerTotals(project: Project) {
  const residentialFloors = Math.max(0, project.typeFloors?.count ?? project.numFloors);
  const residentialFloorH = project.typeFloors?.heightM ?? project.floorHeight;
  const stack = computeOfficeStack(project);
  const officeFloors = stack.towerFloors;
  return {
    residentialFloors,
    residentialFloorH,
    officeFloors,
    officeFloorH: stack.heightM,
    officePosition: stack.towerPosition,
    floors: residentialFloors + officeFloors,
    heightM: residentialFloors * residentialFloorH + officeFloors * stack.heightM,
  };
}
