import type { Project, ProgramCell, Typology, UnitCategory } from "../types";
import { residentialSubGFA } from "./gfa";
import { TYPOLOGY_KEYS, type TypologyKey } from "../zone-classes";

const CATEGORY_FOR_TYPOLOGY_KEY: Record<TypologyKey, UnitCategory | null> = {
  studio: "Studio",
  "1BR": "1BR",
  "2BR": "2BR",
  "3BR": "3BR",
  "4BR": "4BR",
  "5BR": null,
  "6BR": null,
  "7BR": null,
  penthouse: "Penthouse",
};

/** Resolve the typology mix to use for this project.
 *
 *  Starts from the class default (0..1 fractions) and lets the project
 *  override the percentage for each `UnitCategory` via `project.typologyMix`
 *  (values stored as 0..100 percentages). Categories without a key in the
 *  mix matrix (5BR / 6BR / 7BR) are passed through untouched. */
export function resolveTypologyMix(
  project: Project,
  classMix: Record<TypologyKey, number>,
): Record<TypologyKey, number> {
  const override = project.typologyMix ?? {};
  const out = { ...classMix };
  for (const k of TYPOLOGY_KEYS) {
    const cat = CATEGORY_FOR_TYPOLOGY_KEY[k];
    if (!cat) continue;
    const v = override[cat];
    if (v !== undefined) out[k] = Math.max(0, v) / 100;
  }
  return out;
}

/** Read back the effective percentage (0..100) for a category, falling back
 *  to the class default when there is no project-level override. */
export function effectiveMixPctForCategory(
  project: Project,
  classMix: Record<TypologyKey, number>,
  category: UnitCategory,
): number {
  const override = project.typologyMix?.[category];
  if (override !== undefined) return Math.max(0, override);
  const k = TYPOLOGY_KEYS.find((kk) => CATEGORY_FOR_TYPOLOGY_KEY[kk] === category);
  if (!k) return 0;
  return Math.max(0, classMix[k]) * 100;
}

export interface AutoFillResult {
  cells: ProgramCell[];
  totalUnits: number;
  perTypology: Array<{ typology: Typology; units: number; allocatedGFA: number; sameCat: number }>;
}

/** Pure computation of the Apartments matrix from a project + a resolved
 *  typology mix. Treats `mix` as a share of TOTAL UNITS (fractions 0..1) and
 *  derives total unit count from the apartments GFA target and the
 *  weighted-average interior area. Distributes units across floors so that
 *  per-floor totals end up as balanced as possible.
 *
 *  Returns `null` when the inputs can't drive a meaningful fill — empty
 *  Apartments GFA, no typologies, no floors.
 */
export function computeProgramAutoFill(
  project: Project,
  mix: Record<TypologyKey, number>,
): AutoFillResult | null {
  const apartmentsGFA = residentialSubGFA(project, "apartments");
  if (apartmentsGFA <= 0) return null;
  const numFloors = Math.max(1, project.numFloors);
  if (project.typologies.length === 0) return null;

  const rows = project.typologies.map((t) => {
    const k = TYPOLOGY_KEYS.find((kk) => CATEGORY_FOR_TYPOLOGY_KEY[kk] === t.category);
    const pct = k ? mix[k] : 0;
    const sameCat = project.typologies.filter((x) => x.category === t.category).length || 1;
    const unitShare = pct / sameCat;
    return { typology: t, unitShare, sameCat };
  });

  const avgArea = rows.reduce((s, r) => s + r.unitShare * r.typology.internalArea, 0);
  const N = avgArea > 0 ? apartmentsGFA / avgArea : 0;
  const targets = rows.map((r) => {
    const units = Math.round(N * r.unitShare);
    return {
      typology: r.typology,
      units,
      allocatedGFA: units * r.typology.internalArea,
      sameCat: r.sameCat,
    };
  });

  const totalUnits = targets.reduce((s, t) => s + t.units, 0);
  if (totalUnits <= 0) return { cells: [], totalUnits: 0, perTypology: targets };

  // Distribute across floors balancing per-floor totals.
  const cellsByFloor: Record<number, { typologyId: string; count: number }[]> = {};
  for (let f = 1; f <= numFloors; f++) cellsByFloor[f] = [];
  const floorTotal: number[] = Array(numFloors + 1).fill(0);
  for (const { typology, units } of targets) {
    if (units <= 0) continue;
    const perFloor = Math.floor(units / Math.max(1, numFloors));
    const remainder = units - perFloor * numFloors;
    if (perFloor > 0) {
      for (let f = 1; f <= numFloors; f++) {
        cellsByFloor[f].push({ typologyId: typology.id, count: perFloor });
        floorTotal[f] += perFloor;
      }
    }
    if (remainder > 0) {
      const floors = Array.from({ length: numFloors }, (_, i) => i + 1)
        .sort((a, b) => floorTotal[a] - floorTotal[b] || a - b);
      for (const f of floors.slice(0, remainder)) {
        const existing = cellsByFloor[f].find((c) => c.typologyId === typology.id);
        if (existing) existing.count += 1;
        else cellsByFloor[f].push({ typologyId: typology.id, count: 1 });
        floorTotal[f] += 1;
      }
    }
  }

  const cells: ProgramCell[] = [];
  for (const [fStr, list] of Object.entries(cellsByFloor)) {
    const floor = parseInt(fStr, 10);
    for (const { typologyId, count } of list) {
      if (count > 0) cells.push({ floor, typologyId, count });
    }
  }

  return { cells, totalUnits, perTypology: targets };
}
