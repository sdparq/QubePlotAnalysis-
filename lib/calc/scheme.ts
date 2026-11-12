import type { Project } from "../types";
import { residentialGFATarget } from "./gfa";
import { officeGFA } from "./offices";
import { retailGFA } from "./retail";
import { computeTowerYield } from "./tower-yield";

/** A scheme with offices and/or retail and NO residential GFA (e.g. an
 *  office building over ground-floor retail). */
export function isNonResidential(project: Project): boolean {
  return residentialGFATarget(project) <= 0 && officeGFA(project) + retailGFA(project) > 0;
}

/** Units placed on the floors the Apartments matrix currently covers. */
export function activeUnits(project: Project): number {
  const ids = new Set(project.typologies.map((t) => t.id));
  return project.program
    .filter((c) => c.floor >= 1 && c.floor <= project.numFloors && ids.has(c.typologyId))
    .reduce((s, c) => s + c.count, 0);
}

/**
 * The residential tower floor count the project SHOULD hold, or null to leave
 * it alone. Everything downstream (Apartments, Parking, Lifts, Massing) reads
 * project.numFloors / typeFloors.count, so this is persisted by a single sync
 * (useTowerFloorsSync) instead of each tab deriving its own copy.
 *
 *   - residential GFA and a tower footprint → GFA-driven floors (min 1)
 *   - no residential use and no units placed → 0: the tower holds no apartments
 *   - no residential use but units still placed → null: never drop someone's
 *     matrix silently — Distribution offers a button instead
 *   - residential again after a 0 → back to at least 1 floor
 */
export function desiredResidentialFloors(project: Project): number | null {
  const current = project.typeFloors?.count ?? project.numFloors;
  if (isNonResidential(project)) {
    if (current === 0) return null;
    return activeUnits(project) > 0 ? null : 0;
  }
  const y = computeTowerYield(project);
  if (y.towerFootprintM2 > 0 && y.towerTargetGFA > 0) return Math.max(1, y.towerFloors);
  if (current === 0 && residentialGFATarget(project) > 0) return 1;
  return null;
}
