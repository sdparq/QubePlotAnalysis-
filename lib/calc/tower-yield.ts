import type { Project } from "../types";
import { residentialGFATarget } from "./gfa";
import { computeOfficeStack, towerParking } from "./offices";

export interface TowerYieldResult {
  groundFootprintM2: number;
  podiumFootprintM2: number;
  towerFootprintM2: number;
  groundCount: number;
  podiumCount: number;
  groundGFA: number;
  podiumGFA: number;
  /** Podium levels given to offices (Distribution → offices) — their plates
   *  hold office GFA, so they are NOT taken off the residential GFA. */
  podiumOfficeLevels: number;
  /** Residential GFA that must land on the tower = residential target minus
   *  the ground-floor AND (non-office) podium surfaces (whatever the base
   *  absorbs doesn't need tower floors). */
  towerTargetGFA: number;
  /** Tower parking surface hosted by the residential floors (0 when the
   *  office floors host it, or there is none). */
  towerParkingM2: number;
  /** Floors that towerTargetGFA (+ that parking) needs on this tower footprint, unclamped. */
  requiredTowerFloors: number;
  /** Optional zoning cap on tower floor count. */
  maxTowerFloors: number | null;
  /** requiredTowerFloors, clamped to maxTowerFloors when set — this is what
   *  gets persisted into project.typeFloors.count / numFloors. */
  towerFloors: number;
  towerGFA: number;
  /** True when the cap is binding — the residential GFA doesn't fully fit. */
  exceedsMax: boolean;
  /** How many floors' worth of residential GFA is left unbuilt because of the cap. */
  floorsShort: number;
  /** m² of residential GFA that doesn't fit within the capped floor count. */
  gfaShort: number;
}

/** Tower floor count as a function of manually-entered floor-plate areas
 *  (Distribution) instead of plot-polygon geometry (Massing) — the user
 *  types footprints they already know from their own zoning study rather
 *  than trusting our setback/tracing pipeline. Pure; no persistence. */
export function computeTowerYield(project: Project): TowerYieldResult {
  const groundFootprintM2 = Math.max(0, project.groundFootprintM2 ?? 0);
  const podiumFootprintM2 = Math.max(0, project.podiumFootprintM2 ?? 0);
  const towerFootprintM2 = Math.max(0, project.towerFootprintM2 ?? 0);
  const groundCount = project.ground?.count ?? 1;
  const podiumCount = project.podium?.count ?? 0;

  const groundGFA = groundFootprintM2 * groundCount;
  const podiumGFA = podiumFootprintM2 * podiumCount;
  const podiumOfficeLevels = computeOfficeStack(project).podiumLevels.length;
  const podiumResidentialGFA = podiumFootprintM2 * Math.max(0, podiumCount - podiumOfficeLevels);
  const towerTargetGFA = Math.max(0, residentialGFATarget(project) - groundGFA - podiumResidentialGFA);

  // Parking on the residential tower floors uses plate area the apartments
  // can't: the same GFA then needs more floors.
  const tp = towerParking(project);
  const towerParkingM2 = tp.host === "residential" && towerTargetGFA > 0 ? tp.surface : 0;
  const requiredTowerFloors =
    towerFootprintM2 > 0 ? Math.floor((towerTargetGFA + towerParkingM2) / towerFootprintM2) : 0;
  const maxTowerFloors = project.maxTowerFloors && project.maxTowerFloors > 0 ? project.maxTowerFloors : null;
  const towerFloors = maxTowerFloors !== null ? Math.min(requiredTowerFloors, maxTowerFloors) : requiredTowerFloors;
  const towerGFA = Math.max(0, towerFootprintM2 * towerFloors - towerParkingM2);
  const exceedsMax = maxTowerFloors !== null && requiredTowerFloors > maxTowerFloors;

  return {
    groundFootprintM2,
    podiumFootprintM2,
    towerFootprintM2,
    groundCount,
    podiumCount,
    groundGFA,
    podiumGFA,
    podiumOfficeLevels,
    towerTargetGFA,
    towerParkingM2,
    requiredTowerFloors,
    maxTowerFloors,
    towerFloors,
    towerGFA,
    exceedsMax,
    floorsShort: exceedsMax ? requiredTowerFloors - towerFloors : 0,
    gfaShort: exceedsMax ? towerTargetGFA - towerGFA : 0,
  };
}
