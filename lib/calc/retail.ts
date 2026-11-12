import type { Project } from "../types";

/**
 * Retail, distributed like the other uses:
 *
 *   retail GFA (Setup → GFA breakdown → Retail)
 *     − circulation  (arcades, shared lobbies, toilets, back of house)  % of retail GFA
 *     = net lettable shops  →  retail GSA
 *
 *   services (MEP rooms, shafts, plant) — % of retail GFA, but BUA ONLY:
 *   MEP rooms don't count as GFA, so they don't reduce the shops; they are
 *   built area on top of the retail GFA (same rule as residential services).
 *
 * Both default to 0 %, so a project that never touches this keeps selling
 * its whole retail GFA, as before.
 */
export const DEFAULT_RETAIL_BREAKDOWN = { circulationPct: 0, servicesPct: 0 } as const;

export interface RetailResult {
  retailGFA: number;
  circulationPct: number;
  servicesPct: number;
  /** 100 − circulation, floored at 0 (services are BUA only). */
  netPct: number;
  circulation: number;
  /** MEP rooms / shafts / plant — BUA only, on top of the retail GFA. */
  services: number;
  /** Net lettable retail — the retail GSA. */
  net: number;
}

/** Retail GFA (m²) from Setup's GFA breakdown. */
export function retailGFA(project: Project): number {
  const item = project.gfaBreakdown?.retail;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return Math.max(0, item.mode === "absolute" ? item.value : (item.value / 100) * target);
}

export function computeRetail(project: Project): RetailResult {
  const gfa = retailGFA(project);
  const rb = project.retailBreakdown ?? {};
  const circulationPct = Math.max(0, rb.circulationPct ?? DEFAULT_RETAIL_BREAKDOWN.circulationPct);
  const servicesPct = Math.max(0, rb.servicesPct ?? DEFAULT_RETAIL_BREAKDOWN.servicesPct);
  const netPct = Math.max(0, 100 - circulationPct);
  return {
    retailGFA: gfa,
    circulationPct,
    servicesPct,
    netPct,
    circulation: (gfa * circulationPct) / 100,
    services: (gfa * servicesPct) / 100,
    net: (gfa * netPct) / 100,
  };
}
