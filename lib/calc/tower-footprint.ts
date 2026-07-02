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

/** Maximum tower footprint (m²) — the plot polygon shrunk by the tower
 *  setback. Uses the per-edge setback when it's been set (and matches the
 *  polygon), otherwise the uniform value on every edge. This is the ceiling
 *  the tower can occupy on its own tier — independent of whatever the
 *  Massing tab is currently rendering. */
export function computeMaxTowerFootprintM2(project: Project): number {
  const plot = resolvePlotPolygon(project);
  if (plot.length < 3) return 0;
  const uniform = Math.max(0, project.towerSetbackM ?? 6);
  const perEdge = project.towerSetbackPerEdge;
  const setbacks = perEdge && perEdge.length === plot.length
    ? perEdge.map((v) => Math.max(0, v))
    : plot.map(() => uniform);
  if (setbacks.every((s) => s <= 0)) return polygonArea(plot);
  const shrunk = offsetPolygon(plot, setbacks);
  return polygonArea(shrunk);
}
