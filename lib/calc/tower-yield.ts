import type { Project } from "../types";
import { residentialSubQuota } from "./gfa";

export interface TowerYieldResult {
  groundFootprintM2: number;
  podiumFootprintM2: number;
  towerFootprintM2: number;
  groundCount: number;
  podiumCount: number;
  groundGFA: number;
  podiumGFA: number;
  /** Apartments quota (residential GFA × apartments %) — the tower floors
   *  hold the apartments, so THIS is what sizes the tower, not the full
   *  residential GFA (amenities/services live in the podium/base). */
  apartmentsGFA: number;
  /** Floors the apartments GFA needs on this tower footprint, unclamped. */
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
  const apartmentsGFA = residentialSubQuota(project, "apartments");

  const requiredTowerFloors = towerFootprintM2 > 0 ? Math.floor(apartmentsGFA / towerFootprintM2) : 0;
  const maxTowerFloors = project.maxTowerFloors && project.maxTowerFloors > 0 ? project.maxTowerFloors : null;
  const towerFloors = maxTowerFloors !== null ? Math.min(requiredTowerFloors, maxTowerFloors) : requiredTowerFloors;
  const towerGFA = towerFootprintM2 * towerFloors;
  const exceedsMax = maxTowerFloors !== null && requiredTowerFloors > maxTowerFloors;

  return {
    groundFootprintM2,
    podiumFootprintM2,
    towerFootprintM2,
    groundCount,
    podiumCount,
    groundGFA,
    podiumGFA,
    apartmentsGFA,
    requiredTowerFloors,
    maxTowerFloors,
    towerFloors,
    towerGFA,
    exceedsMax,
    floorsShort: exceedsMax ? requiredTowerFloors - towerFloors : 0,
    gfaShort: exceedsMax ? apartmentsGFA - towerGFA : 0,
  };
}
