/**
 * Shared residential GFA / BUA accounting.
 *
 * Mental model
 * ────────────
 *   residentialGFA target = user input in Setup (gfaBreakdown.residential)
 *
 *   Three common-area groups live in the Common Areas tab:
 *     Amenities    — % of residentialGFA → counts as GFA and BUA
 *     Circulation  — % of residentialGFA → counts as GFA and BUA
 *     Services     — absolute m² (project.servicesBUA) → BUA only, not GFA
 *
 *   The four residential GFA shares always sum to 100% by construction:
 *     apartments  = 100 − amenities − circulation
 *     amenities   = residentialBreakdown.amenities.pct   (user input)
 *     circulation = residentialBreakdown.circulation.pct (user input)
 *     services    = 0  (Services no longer competes for residential GFA)
 *
 *   apartments BUA = apartments GFA × (1 + balconyShare)   (balconies inflate BUA)
 *   residentialBUA = apartments BUA + amenities + circulation + servicesBUA
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
 *  Amenities / circulation come from the user input. Apartments is derived as
 *  100% − (amenities + circulation). Services is always 0 (Services lives in
 *  servicesBUA as absolute m² and is BUA-only). */
export function residentialSubPct(project: Project, sub: ResidentialSubCategory): number {
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  if (sub === "services") return 0;
  if (sub === "apartments") {
    const others = (rb.amenities?.pct ?? 0) + (rb.circulation?.pct ?? 0);
    return Math.max(0, 100 - others);
  }
  return rb[sub]?.pct ?? 0;
}

/** Target GFA quota for a residential sub (m²). */
export function residentialSubQuota(project: Project, sub: ResidentialSubCategory): number {
  return (residentialSubPct(project, sub) / 100) * residentialGFATarget(project);
}

export function residentialSubGFA(project: Project, sub: ResidentialSubCategory): number {
  if (sub === "services") return 0;
  return residentialSubQuota(project, sub);
}

export function residentialSubBUA(project: Project, sub: ResidentialSubCategory): number {
  if (sub === "services") return Math.max(0, project.servicesBUA ?? 0);
  if (sub === "apartments") {
    const quota = residentialSubQuota(project, sub);
    if (quota <= 0) return 0;
    const program = computeProgram(project);
    if (program.totalInteriorGFA > 0) {
      const balconyShare = program.totalBalcony / program.totalInteriorGFA;
      return quota * (1 + balconyShare);
    }
    return quota;
  }
  // Amenities / circulation: BUA equals GFA — every m² counted is built area.
  return residentialSubQuota(project, sub);
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
