/**
 * Shared residential GFA / BUA accounting.
 *
 * Mental model
 * ────────────
 *   residentialGFA target = user input in Setup (gfaBreakdown.residential)
 *
 *   For each residential sub (apartments / amenities / circulation / services):
 *     pct[sub]      = residentialBreakdown.pct (apartments is auto-derived =
 *                     100 − Σ groups so the four always sum to 100%)
 *     subQuota      = (pct[sub] / 100) × residentialGFA target
 *
 *   apartments has no sub-breakdown:
 *     subGFA = subQuota
 *     subBUA = subGFA × (1 + balconyShare)   (balconies inflate BUA only)
 *
 *   amenities / circulation / services: each row's pct is a fraction of the
 *   group's GFA quota and every row counts as GFA. Non-GFA built area lives
 *   in a separate block below the Common Areas table (added later).
 *     row m² = subQuota × row.pct / 100
 *     subGFA = subBUA = subQuota × (Σ row pcts / 100)
 *
 *   When the rows in a group sum to exactly 100%, GFA = quota. Lower sums
 *   under-deliver the quota; higher sums over-deliver it.
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
 *  amenities / circulation / services come from the user input in Common Areas.
 *  apartments is auto-derived = 100% − (amenities + circulation + services), so
 *  the four always sum to 100% of the residential allocation. */
export function residentialSubPct(project: Project, sub: ResidentialSubCategory): number {
  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  if (sub === "apartments") {
    const others = (rb.amenities?.pct ?? 0) + (rb.circulation?.pct ?? 0) + (rb.services?.pct ?? 0);
    return Math.max(0, 100 - others);
  }
  return rb[sub]?.pct ?? 0;
}

function subQuota(project: Project, sub: ResidentialSubCategory): number {
  return (residentialSubPct(project, sub) / 100) * residentialGFATarget(project);
}

/** Sum of common-area sub-row pcts inside a group (100 when no breakdown). */
function groupSubPctSum(project: Project, sub: ResidentialSubCategory): number {
  const subs = project.commonAreasBreakdown?.[sub as Exclude<ResidentialSubCategory, "apartments">];
  if (!subs || subs.length === 0) return 100;
  return subs.reduce((s, x) => s + x.pct, 0);
}

export function residentialSubGFA(project: Project, sub: ResidentialSubCategory): number {
  const quota = subQuota(project, sub);
  if (quota <= 0) return 0;
  if (sub === "apartments") return quota;
  return (quota * groupSubPctSum(project, sub)) / 100;
}

export function residentialSubBUA(project: Project, sub: ResidentialSubCategory): number {
  const quota = subQuota(project, sub);
  if (quota <= 0) return 0;
  if (sub === "apartments") {
    const program = computeProgram(project);
    if (program.totalInteriorGFA > 0) {
      const balconyShare = program.totalBalcony / program.totalInteriorGFA;
      return quota * (1 + balconyShare);
    }
    return quota;
  }
  // Common-area groups: every row counts as GFA, so BUA equals GFA here.
  return (quota * groupSubPctSum(project, sub)) / 100;
}

/** Quota helper (m²) — exported so the Common Areas tab can use the same source of truth. */
export function residentialSubQuota(project: Project, sub: ResidentialSubCategory): number {
  return subQuota(project, sub);
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

