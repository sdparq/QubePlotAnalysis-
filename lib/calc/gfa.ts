/**
 * Shared residential GFA / BUA accounting.
 *
 * Mental model
 * ────────────
 *   residentialGFA target = user input in Setup (gfaBreakdown.residential)
 *
 *   For each residential sub (apartments / amenities / circulation / services):
 *     subQuota       = (rb[sub].pct / 100) × residentialGFA target
 *                      → the "% of residential" the user types in Common Areas
 *
 *   apartments has no sub-breakdown:
 *     subGFA = subQuota                    (when residentialBreakdown.countsAsGFA)
 *     subBUA = subGFA × (1 + balconyShare) (balconies inflate BUA, not GFA)
 *
 *   amenities / circulation / services have a Common Areas sub-breakdown.
 *   Each row's pct is a fraction of the group's GFA QUOTA:
 *     row m²   = subQuota × row.pct / 100
 *     subGFA   = Σ row m² for rows flagged GFA       = subQuota × (Σ gfa pcts / 100)
 *     subBUA   = Σ row m² across all rows in group   = subQuota × (Σ all pcts / 100)
 *
 *   So the user controls GFA delivery by tweaking the GFA-counted rows (they
 *   should sum to 100% to cover the quota). Non-GFA rows are additive extras
 *   that inflate BUA above the quota without affecting GFA — exactly what the
 *   user asked for ("los GFA suman el % adecuado de residential, el BUA va
 *   aparte").
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

/** Σ percent of common-area sub-rows, split by GFA / total. */
function groupSubPcts(project: Project, sub: ResidentialSubCategory): { all: number; gfa: number } {
  const subs = project.commonAreasBreakdown?.[sub as Exclude<ResidentialSubCategory, "apartments">];
  if (!subs || subs.length === 0) return { all: 100, gfa: 100 };
  const all = subs.reduce((s, x) => s + x.pct, 0);
  const gfa = subs.filter((x) => x.countsAsGFA).reduce((s, x) => s + x.pct, 0);
  return { all, gfa };
}

export function residentialSubGFA(project: Project, sub: ResidentialSubCategory): number {
  const quota = subQuota(project, sub);
  if (quota <= 0) return 0;
  if (sub === "apartments") return quota;
  const { gfa } = groupSubPcts(project, sub);
  return (quota * gfa) / 100;
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
  const { all } = groupSubPcts(project, sub);
  return (quota * all) / 100;
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
