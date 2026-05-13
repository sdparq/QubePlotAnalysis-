/**
 * Default sub-breakdown of common areas — used by the Common Areas tab's
 * "Generate from Setup" action. Percentages are relative to the parent group
 * (e.g. Pool 20% of all Amenities) and can be edited afterwards in the
 * generated rows.
 */

import type { CommonArea } from "./types";

export interface CommonAreaSubDefault {
  name: string;
  pct: number;             // % of the parent group total (amenities / circulation / services)
  countsAsGFA: boolean;    // true → CommonArea category "GFA"; false → "OPEN"
}

export const DEFAULT_AMENITIES_SUBS: CommonAreaSubDefault[] = [
  { name: "Gym",           pct: 25, countsAsGFA: true  },
  { name: "Pool",          pct: 20, countsAsGFA: false },
  { name: "Sauna",         pct: 5,  countsAsGFA: true  },
  { name: "Padel court",   pct: 15, countsAsGFA: false },
  { name: "Social area",   pct: 15, countsAsGFA: true  },
  { name: "Kids area",     pct: 10, countsAsGFA: true  },
  { name: "Coworking",     pct: 10, countsAsGFA: true  },
];

export const DEFAULT_CIRCULATION_SUBS: CommonAreaSubDefault[] = [
  { name: "Lobbies",       pct: 30, countsAsGFA: true },
  { name: "Corridors",     pct: 35, countsAsGFA: true },
  { name: "Lift cores",    pct: 20, countsAsGFA: true },
  { name: "Stairs",        pct: 15, countsAsGFA: true },
];

export const DEFAULT_SERVICES_SUBS: CommonAreaSubDefault[] = [
  { name: "MEP rooms",     pct: 30, countsAsGFA: true },
  { name: "Shafts",        pct: 35, countsAsGFA: true },
  { name: "Ducts",         pct: 15, countsAsGFA: true },
  { name: "Plant rooms",   pct: 20, countsAsGFA: true },
];

export interface GeneratedRow extends CommonArea {}

/** Generate one CommonArea row per sub-default, sized to its % of the parent
 *  group's BUA. Names are prefixed with the parent group so they sort nicely. */
export function generateRowsFromSubs(
  parentLabel: string,
  parentBUA: number,
  subs: CommonAreaSubDefault[],
): GeneratedRow[] {
  const out: GeneratedRow[] = [];
  for (const sub of subs) {
    if (parentBUA <= 0 || sub.pct <= 0) continue;
    out.push({
      id: `ca-${parentLabel.toLowerCase()}-${sub.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      name: `${parentLabel} · ${sub.name}`,
      area: Number(((parentBUA * sub.pct) / 100).toFixed(2)),
      floors: 1,
      category: sub.countsAsGFA ? "GFA" : "OPEN",
    });
  }
  return out;
}
