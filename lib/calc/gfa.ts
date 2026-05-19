/**
 * Shared residential GFA / BUA accounting.
 *
 * Mental model
 * ────────────
 *   residentialGFA target = user input in Setup (gfaBreakdown.residential)
 *
 *   Three groups live in the Distribution tab:
 *     Amenities    — % of residentialGFA → counts as GFA and BUA. Eats apartments.
 *     Circulation  — % of residentialGFA → counts as GFA and BUA. Eats apartments.
 *     Services     — % of residentialGFA → BUA only, NOT GFA. Extra BUA on top
 *                    (does not reduce apartments).
 *
 *   apartments% = 100 − amenities% − circulation%    (services excluded)
 *
 *   apartments BUA = apartments GFA × (1 + balconyShare)
 *   services BUA   = services% × residentialGFA
 *   residentialBUA = apartments + amenities + circulation + services
 */

import type { Project, ResidentialSubCategory } from "../types";
import { DEFAULT_RESIDENTIAL_BREAKDOWN } from "../types";
import { computeProgram } from "./program";

export const RESIDENTIAL_SUBS: ResidentialSubCategory[] = ["apartments", "amenities", "circulation", "services"];

export function residentialGFATarget(project: Project): number {
  const item = project.gfaBreakdown?.residential;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

/** Effective % of residentialGFA for a sub.
 *  amenities / circulation / services come from the user input. Apartments is
 *  100% − (amenities + circulation) — services is BUA-only and does NOT
 *  compete for the residential GFA pie. */
export function residentialSubPct(project: Project, sub: ResidentialSubCategory): number {
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  if (sub === "apartments") {
    const others = (rb.amenities?.pct ?? 0) + (rb.circulation?.pct ?? 0);
    return Math.max(0, 100 - others);
  }
  return rb[sub]?.pct ?? 0;
}

/** m² implied by a sub's percentage of residentialGFA. */
export function residentialSubQuota(project: Project, sub: ResidentialSubCategory): number {
  return (residentialSubPct(project, sub) / 100) * residentialGFATarget(project);
}

export function residentialSubGFA(project: Project, sub: ResidentialSubCategory): number {
  if (sub === "services") return 0;
  return residentialSubQuota(project, sub);
}

export function residentialSubBUA(project: Project, sub: ResidentialSubCategory): number {
  const quota = residentialSubQuota(project, sub);
  if (quota <= 0) return 0;
  if (sub === "apartments") {
    const program = computeProgram(project);
    if (program.totalInteriorGFA > 0) {
      const balconyShare = program.totalBalcony / program.totalInteriorGFA;
      return quota * (1 + balconyShare);
    }
    return quota;
  }
  // amenities / circulation / services: BUA equals m² implied by the % input.
  return quota;
}

export function residentialBUA(project: Project): number {
  return RESIDENTIAL_SUBS.reduce((s, sub) => s + residentialSubBUA(project, sub), 0);
}

/** residentialBUA expressed as a multiple of the residentialGFA allocation. */
export function residentialBuaInflationFactor(project: Project): number {
  const gfa = residentialGFATarget(project);
  if (gfa <= 0) return 1;
  return residentialBUA(project) / gfa;
}

