import type { Project, Typology } from "../types";

/**
 * Balconies and GFA. Authorities differ on how much of a balcony counts
 * towards the floor area ratio — many exempt it, some count half, some all
 * of it — so the project picks 0 / 50 / 100 % in Typologies.
 *
 * A unit's GFA is interior + factor × balcony. Its sellable area and its
 * built area are physical and always take the WHOLE balcony.
 *
 * (Lives apart from gfa.ts so program.ts can use it without an import cycle.)
 */

/** Fraction (0, 0.5 or 1) of every balcony that counts as GFA. */
export function balconyGfaFactor(project: Project): number {
  const pct = project.balconyGfaPct ?? 0;
  return Math.max(0, Math.min(1, pct / 100));
}

/** GFA one unit of this typology consumes: interior + the counted balcony share. */
export function unitGfaArea(project: Project, t: Typology): number {
  return t.internalArea + balconyGfaFactor(project) * t.balconyArea;
}
