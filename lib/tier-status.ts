import type { Project } from "./types";
import { polygonArea } from "./geom";
import { resolveTiers, tracedBlocks, type TierKey } from "./tier-geometry";
import { computeOfficeStack, officeGFA } from "./calc/offices";
import { residentialGFATarget } from "./calc/gfa";

/**
 * A tier is only modelled in Massing when it has FLOORS, and floors don't
 * come from Plot's geometry: ground / podium levels are Setup's floor
 * breakdown, tower floors are derived in Distribution from the GFA and the
 * footprint figures typed there. These helpers say how many floors each tier
 * has, why a tier has none, and how Plot's footprints compare with
 * Distribution's — so the gap can be shown and closed from Plot or Massing.
 */
export interface TierFloors {
  ground: number;
  podium: number;
  /** Residential type floors + office floors stacked in the tower. */
  tower: number;
  towerResidential: number;
  towerOffice: number;
}

export function tierFloors(project: Project): TierFloors {
  const towerResidential = Math.max(0, project.typeFloors?.count ?? project.numFloors);
  const towerOffice = computeOfficeStack(project).towerFloors;
  return {
    ground: Math.max(0, project.ground?.count ?? 1),
    podium: Math.max(0, project.podium?.count ?? 0),
    tower: towerResidential + towerOffice,
    towerResidential,
    towerOffice,
  };
}

/** Footprint area (m²) of each tier as Plot defines it (all blocks summed). */
export function plotFootprints(project: Project): Record<TierKey, number> {
  const t = resolveTiers(project);
  const area = (k: TierKey) => t[k].polygons.reduce((s, poly) => s + polygonArea(poly), 0);
  return { ground: area("ground"), podium: area("podium"), tower: area("tower") };
}

/** The footprint figures Distribution counts floors with (0 = not entered). */
export function distributionFootprints(project: Project): Record<TierKey, number> {
  return {
    ground: Math.max(0, project.groundFootprintM2 ?? 0),
    podium: Math.max(0, project.podiumFootprintM2 ?? 0),
    tower: Math.max(0, project.towerFootprintM2 ?? 0),
  };
}

/** Patch that copies Plot's footprints into Distribution's figures. */
export function footprintsPatch(project: Project): Partial<Project> {
  const fp = plotFootprints(project);
  const r = (v: number) => (v > 0 ? Number(v.toFixed(1)) : undefined);
  return { groundFootprintM2: r(fp.ground), podiumFootprintM2: r(fp.podium), towerFootprintM2: r(fp.tower) };
}

export interface TierIssue {
  tier: TierKey;
  /** Why the tier is not modelled. */
  reason: string;
  /** One-click fix, when there is an obvious one. */
  fix?: { label: string; patch: Partial<Project> };
}

/** Tiers that Massing cannot model because they have no floors. */
export function unmodelledTiers(project: Project): TierIssue[] {
  const f = tierFloors(project);
  const out: TierIssue[] = [];
  if (f.ground <= 0) {
    out.push({
      tier: "ground",
      reason: "The ground floor has 0 levels in Setup → Floor breakdown.",
      fix: { label: "Add the ground floor", patch: { ground: { count: 1, heightM: project.ground?.heightM ?? 4.5 } } },
    });
  }
  // A podium with 0 levels is normal — only flag it when the user gave it a geometry.
  const podiumDefined = project.tierMode?.podium !== undefined || tracedBlocks(project, "podium").length > 0;
  if (f.podium <= 0 && podiumDefined) {
    out.push({
      tier: "podium",
      reason: "The podium has a footprint in Plot but 0 levels in Setup → Floor breakdown.",
      fix: { label: "Add 1 podium level", patch: { podium: { count: 1, heightM: project.podium?.heightM ?? 4.0 } } },
    });
  }
  if (f.tower <= 0) {
    const hasUse = residentialGFATarget(project) > 0 || officeGFA(project) > 0;
    const noPlate = (project.towerFootprintM2 ?? 0) <= 0;
    const area = plotFootprints(project).tower;
    if (!hasUse) {
      out.push({ tier: "tower", reason: "The tower has no floors: Setup has no residential or office GFA to put in it." });
    } else if (noPlate && area > 0) {
      out.push({
        tier: "tower",
        reason: "The tower has no floors yet: they are counted in Distribution from the GFA ÷ the tower footprint, which is empty there.",
        fix: {
          label: `Use Plot's tower footprint (${Math.round(area).toLocaleString("en-US")} m²)`,
          patch: { towerFootprintM2: Number(area.toFixed(1)) },
        },
      });
    } else {
      out.push({ tier: "tower", reason: "The tower has 0 floors — check Distribution (GFA left for the tower, footprint and floor cap)." });
    }
  }
  return out;
}
