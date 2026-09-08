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
 *   apartments BUA = apartments GFA × (unit BUA ÷ unit GFA)
 *   services BUA   = services% × residentialGFA
 *   residentialBUA = apartments + amenities + circulation + services
 *
 *   Balconies and GFA: a unit's GFA is interior + balconyGfaFactor × balcony
 *   (the project chooses 0 / 50 / 100 % in Typologies). Its BUA and its
 *   sellable area are always interior + the WHOLE balcony.
 */

import type { GfaBreakdownItem, Project, ResidentialSubCategory } from "../types";
import { DEFAULT_RESIDENTIAL_BREAKDOWN } from "../types";
import { computeProgram } from "./program";

export { balconyGfaFactor, unitGfaArea } from "./balcony";

export const RESIDENTIAL_SUBS: ResidentialSubCategory[] = ["apartments", "amenities", "circulation", "services"];

function gfaItemM2(project: Project, item: GfaBreakdownItem | undefined): number {
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

/** m² allocated to Hospitality in Setup's GFA breakdown. */
export function hospitalityGFA(project: Project): number {
  return gfaItemM2(project, project.gfaBreakdown?.hospitality);
}

/** Residential GFA target. Hospitality (hotel keys / branded residences) is
 *  operated as residential stock in this tool, so its allocation rolls into
 *  the residential target and feeds the same pipeline — Distribution quotas,
 *  unit mix, Apartments auto-fill and the sellable GSA. */
export function residentialGFATarget(project: Project): number {
  return gfaItemM2(project, project.gfaBreakdown?.residential) + hospitalityGFA(project);
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
    // Built envelope per GFA-counted m²: the placed units' full sellable
    // (interior + whole balcony) over the GFA they consume (interior + the
    // counted balcony share).
    const program = computeProgram(project);
    if (program.totalApartmentsGFA > 0) {
      return quota * (program.totalSellable / program.totalApartmentsGFA);
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

