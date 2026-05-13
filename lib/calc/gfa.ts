/**
 * Shared residential GFA / BUA accounting.
 *
 *   residentialGFA target = user input in Setup (gfaBreakdown.residential)
 *   subGFA  = subPct × residentialGFA × (countsAsGFA at residential level)
 *   subGfaShare = fraction of a sub's BUA that counts as GFA. Driven by the
 *                 Common Areas sub-breakdown when present. Apartments has no
 *                 sub-breakdown and reduces to the residentialBreakdown flag.
 *   subBUA  = subGFA / subGfaShare  → inflates when Non-GFA subs exist
 *   residentialBUA = Σ subBUA
 *
 * Net effect: Σ subGFA = residentialGFA target by construction. The total BUA
 * grows above the target as users mark sub-rows Non-GFA — those extras are
 * physical built area that doesn't count for FAR.
 */

import type { Project, ResidentialSubCategory } from "../types";
import { DEFAULT_RESIDENTIAL_BREAKDOWN } from "../types";

export const RESIDENTIAL_SUBS: ResidentialSubCategory[] = ["apartments", "amenities", "circulation", "services"];

export function residentialGFATarget(project: Project): number {
  const item = project.gfaBreakdown?.residential;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

/** Fraction of a residential sub's BUA that ends up counted as GFA. */
export function residentialSubGfaShare(project: Project, sub: ResidentialSubCategory): number {
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  if (!rb[sub].countsAsGFA) return 0;
  if (sub === "apartments") return 1;
  const cab = project.commonAreasBreakdown;
  const subs = cab?.[sub];
  if (!subs || subs.length === 0) return 1;
  const gfaPct = subs.filter((s) => s.countsAsGFA).reduce((sum, x) => sum + x.pct, 0);
  return Math.max(0, Math.min(1, gfaPct / 100));
}

export function residentialSubGFA(project: Project, sub: ResidentialSubCategory): number {
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  if (!rb[sub].countsAsGFA) return 0;
  return (rb[sub].pct / 100) * residentialGFATarget(project);
}

export function residentialSubBUA(project: Project, sub: ResidentialSubCategory): number {
  const subGFA = residentialSubGFA(project, sub);
  const share = residentialSubGfaShare(project, sub);
  if (share > 0) return subGFA / share;
  // Non-GFA category at the residential level — its BUA is still allocated as
  // a pure pct of the residentialGFA target (it doesn't deliver any GFA).
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  return (rb[sub].pct / 100) * residentialGFATarget(project);
}

export function residentialBUA(project: Project): number {
  return RESIDENTIAL_SUBS.reduce((s, sub) => s + residentialSubBUA(project, sub), 0);
}

/** Same as residentialBUA but as a fraction of residentialGFA. Useful for the
 *  Setup table to compute the BUA column directly from any GFA input value. */
export function residentialBuaInflationFactor(project: Project): number {
  const gfa = residentialGFATarget(project);
  if (gfa <= 0) return 1;
  return residentialBUA(project) / gfa;
}
