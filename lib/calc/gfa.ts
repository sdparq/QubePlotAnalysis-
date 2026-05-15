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
import { computeProgram } from "./program";

export const RESIDENTIAL_SUBS: ResidentialSubCategory[] = ["apartments", "amenities", "circulation", "services"];

/** Resolve the project's effective Target GFA (m²) — always returned in GFA,
 *  regardless of whether the user entered it as GFA or BUA. When inputting BUA,
 *  the equivalent GFA is `targetBUA / inflation`, where inflation is the project's
 *  current BUA-to-GFA ratio (a pure function of the breakdown percentages, not of
 *  the headline magnitude — so this resolves in a single step without a loop). */
export function effectiveTargetGFA(project: Project): number {
  if (project.areaInputMode === "BUA") {
    const bua = project.targetBUA ?? 0;
    if (bua <= 0) return 0;
    // Use a probe with areaInputMode forced to GFA and targetGFA=1 so the
    // inflation factor calculation references targetGFA=1 directly without
    // recursing back through effectiveTargetGFA.
    const probe: Project = { ...project, areaInputMode: "GFA", targetGFA: 1 };
    const factor = residentialBuaInflationFactor(probe);
    return factor > 0 ? bua / factor : 0;
  }
  return project.targetGFA ?? 0;
}

export function residentialGFATarget(project: Project): number {
  const item = project.gfaBreakdown?.residential;
  if (!item) return 0;
  const target = effectiveTargetGFA(project);
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
  // Cap the Σ subGFAs at residentialGFA target: when the user types percentages
  // that add up to more than 100% across GFA-counted subs, scale them all
  // proportionally so the sum equals the target exactly. Non-GFA subs are
  // ignored here — they don't consume any of the GFA budget.
  const totalGfaPct = RESIDENTIAL_SUBS
    .filter((k) => rb[k].countsAsGFA)
    .reduce((s, k) => s + (rb[k]?.pct ?? 0), 0);
  const scale = totalGfaPct > 100 ? 100 / totalGfaPct : 1;
  return ((rb[sub].pct * scale) / 100) * residentialGFATarget(project);
}

export function residentialSubBUA(project: Project, sub: ResidentialSubCategory): number {
  const subGFA = residentialSubGFA(project, sub);
  const share = residentialSubGfaShare(project, sub);
  if (share <= 0) {
    // Non-GFA category at the residential level — its BUA is still allocated
    // as a pure pct of the residentialGFA target (it doesn't deliver any GFA).
    const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
    return (rb[sub].pct / 100) * residentialGFATarget(project);
  }
  let bua = subGFA / share;
  // Apartments: balconies count as BUA but not as GFA. When the program is
  // filled, the actual balcony ratio comes from the typologies × cells; we
  // scale the apartments BUA by (1 + balcony share) so the difference shows
  // up consistently across Setup, Common Areas and the Areas Summary.
  if (sub === "apartments") {
    const program = computeProgram(project);
    if (program.totalInteriorGFA > 0) {
      const balconyShare = program.totalBalcony / program.totalInteriorGFA;
      bua = subGFA * (1 + balconyShare);
    }
  }
  return bua;
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
