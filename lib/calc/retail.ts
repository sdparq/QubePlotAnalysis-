import type { Project } from "../types";

/**
 * Retail, distributed like the other uses:
 *
 *   retail GFA (Setup → GFA breakdown → Retail)
 *     − circulation  (arcades, mall, shared lobbies)            % of retail GFA
 *     − services     (loading, refuse, MEP, toilets, back of house) % of retail GFA
 *     = net lettable shops  →  retail GSA
 *
 * Both defaults are 0 %, so a project that never touches this keeps selling
 * its whole retail GFA, as before. Circulation and services sit inside the
 * retail GFA, so the retail BUA equals its GFA.
 */
export const DEFAULT_RETAIL_BREAKDOWN = { circulationPct: 0, servicesPct: 0 } as const;

export interface RetailResult {
  retailGFA: number;
  circulationPct: number;
  servicesPct: number;
  /** 100 − circulation − services, floored at 0. */
  netPct: number;
  circulation: number;
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
  const netPct = Math.max(0, 100 - circulationPct - servicesPct);
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
