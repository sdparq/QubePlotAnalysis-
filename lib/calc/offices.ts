import type { Project } from "../types";

/**
 * Commercial / Office use, distributed like the residential GFA:
 *
 *   office GFA (Setup → GFA breakdown → Commercial / Office)
 *     − circulation  (cores, lobbies, corridors)      % of office GFA
 *     − services     (MEP, shafts, toilets, plant)    % of office GFA
 *     = net lettable offices  →  office GSA (no balconies)
 *
 * Circulation and services both sit inside the office GFA here, so the
 * office BUA equals its GFA. Parking: 1 space per `officeM2PerSpace` m² of
 * office GSA (default 50).
 */
export const DEFAULT_OFFICE_BREAKDOWN = { circulationPct: 12, servicesPct: 6 } as const;
export const DEFAULT_OFFICE_M2_PER_SPACE = 50;

export interface OfficeResult {
  officeGFA: number;
  circulationPct: number;
  servicesPct: number;
  /** 100 − circulation − services, floored at 0. */
  netPct: number;
  circulation: number;
  services: number;
  /** Net lettable office area — the office GSA. */
  net: number;
  m2PerSpace: number;
  parkingRequired: number;
}

/** Office GFA (m²) from Setup's GFA breakdown. */
export function officeGFA(project: Project): number {
  const item = project.gfaBreakdown?.commercial;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return Math.max(0, item.mode === "absolute" ? item.value : (item.value / 100) * target);
}

export function computeOffices(project: Project): OfficeResult {
  const gfa = officeGFA(project);
  const ob = project.officeBreakdown ?? {};
  const circulationPct = Math.max(0, ob.circulationPct ?? DEFAULT_OFFICE_BREAKDOWN.circulationPct);
  const servicesPct = Math.max(0, ob.servicesPct ?? DEFAULT_OFFICE_BREAKDOWN.servicesPct);
  const netPct = Math.max(0, 100 - circulationPct - servicesPct);
  const net = (gfa * netPct) / 100;
  const m2PerSpace = project.officeM2PerSpace ?? DEFAULT_OFFICE_M2_PER_SPACE;
  return {
    officeGFA: gfa,
    circulationPct,
    servicesPct,
    netPct,
    circulation: (gfa * circulationPct) / 100,
    services: (gfa * servicesPct) / 100,
    net,
    m2PerSpace,
    parkingRequired: m2PerSpace > 0 && net > 0 ? Math.ceil(net / m2PerSpace) : 0,
  };
}
