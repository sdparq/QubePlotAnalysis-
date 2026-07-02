import type { Point } from "../geom";
import { offsetPolygon, polygonArea, rectanglePlotPolygon } from "../geom";
import type { Project } from "../types";

/** Resolve the plot polygon the same way every tab does: explicit polygon
 *  when in polygon mode, otherwise a rectangle from frontage × depth (falling
 *  back to a square root of plot area when those aren't set). Self-contained
 *  — does not depend on any component. */
function resolvePlotPolygon(project: Project): Point[] {
  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 0;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;
  if (project.plotMode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
    return project.plotPolygon;
  }
  if (frontage <= 0 || depth <= 0) return [];
  return rectanglePlotPolygon(frontage, depth);
}

function tierFootprintArea(plot: Point[], uniformSetback: number, perEdge: number[] | undefined): number {
  if (plot.length < 3) return 0;
  const setbacks = perEdge && perEdge.length === plot.length
    ? perEdge.map((v) => Math.max(0, v))
    : plot.map(() => Math.max(0, uniformSetback));
  if (setbacks.every((s) => s <= 0)) return polygonArea(plot);
  return polygonArea(offsetPolygon(plot, setbacks));
}

export interface TierFootprint {
  /** Footprint after the tier's setback (m²). */
  footprintM2: number;
  floors: number;
  heightM: number;
  /** footprintM2 × floors — the structural GFA the tier can physically hold. */
  gfaM2: number;
}

export interface PlotTierFootprints {
  ground: TierFootprint;
  podium: TierFootprint;
  tower: TierFootprint;
}

/** Structural GFA available on each above-ground tier, derived purely from the
 *  plot polygon + each tier's setback (Massing) and floor count/height
 *  (Setup). Self-contained — does not depend on any component, so it stays
 *  correct regardless of which tab the user is currently on. */
export function computePlotTierFootprints(project: Project): PlotTierFootprints {
  const plot = resolvePlotPolygon(project);

  const groundFootprint = tierFootprintArea(plot, project.groundSetbackM ?? 3, project.groundSetbackPerEdge);
  const podiumFootprint = tierFootprintArea(plot, project.podiumSetbackM ?? 3, project.podiumSetbackPerEdge);
  const towerFootprint = tierFootprintArea(plot, project.towerSetbackM ?? 6, project.towerSetbackPerEdge);

  const groundCount = project.ground?.count ?? 1;
  const groundHeightM = project.ground?.heightM ?? 4.5;
  const podiumCount = project.podium?.count ?? 0;
  const podiumHeightM = project.podium?.heightM ?? 4.0;
  const towerCount = project.typeFloors?.count ?? project.numFloors;
  const towerHeightM = project.typeFloors?.heightM ?? project.floorHeight;

  return {
    ground: { footprintM2: groundFootprint, floors: groundCount, heightM: groundHeightM, gfaM2: groundFootprint * groundCount },
    podium: { footprintM2: podiumFootprint, floors: podiumCount, heightM: podiumHeightM, gfaM2: podiumFootprint * podiumCount },
    tower:  { footprintM2: towerFootprint,  floors: towerCount,  heightM: towerHeightM,  gfaM2: towerFootprint * towerCount },
  };
}

/** Maximum tower footprint alone (m²) — used by Setup to derive the tower
 *  floor count before `project.typeFloors.count` itself is settled. */
export function computeMaxTowerFootprintM2(project: Project): number {
  const plot = resolvePlotPolygon(project);
  return tierFootprintArea(plot, project.towerSetbackM ?? 6, project.towerSetbackPerEdge);
}
