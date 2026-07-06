"use client";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ZONE_CLASSES,
  TYPOLOGY_KEYS,
  type TypologyKey,
  type ZoneClass,
  type ZoneClassRow,
} from "./zone-classes";

const STORAGE_KEY = "qube-zone-library-v1";

/* ---------------------------- Deep sanitising ----------------------------- */
/* A saved library snapshot can carry rows written by an older code version or
 * a partial write — e.g. an empty `typologyMix` — and the old shallow merge
 * let those broken objects permanently shadow the seed data. Since the
 * library is shared across every project, one corrupted class row silently
 * broke "Apply class X mix" (0 typologies created) in ALL projects. Validate
 * every critical field per class and fall back to the seed value when the
 * stored one is malformed. */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && v[0] >= 0 && v[1] >= 0;

function sanitizeKeyedNumbers(
  stored: unknown,
  fallback: Record<TypologyKey, number>,
): Record<TypologyKey, number> {
  const src = (stored ?? {}) as Record<string, unknown>;
  const out = {} as Record<TypologyKey, number>;
  for (const k of TYPOLOGY_KEYS) {
    const v = src[k];
    out[k] = isNum(v) && v >= 0 ? v : fallback[k];
  }
  // A mix that sums to ~0 creates zero typologies — treat as corrupt.
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  return sum > 0.01 ? out : { ...fallback };
}

function sanitizeKeyedRanges(
  stored: unknown,
  fallback: Record<TypologyKey, [number, number]>,
): Record<TypologyKey, [number, number]> {
  const src = (stored ?? {}) as Record<string, unknown>;
  const out = {} as Record<TypologyKey, [number, number]>;
  for (const k of TYPOLOGY_KEYS) {
    const v = src[k];
    out[k] = isRange(v) ? (v as [number, number]) : [...fallback[k]] as [number, number];
  }
  return out;
}

function sanitizeRow(letter: ZoneClass, stored: Partial<ZoneClassRow> | undefined): ZoneClassRow {
  const def = DEFAULT_ZONE_CLASSES[letter];
  if (!stored || typeof stored !== "object") return def;
  const fh = (stored.floorHeights ?? {}) as Partial<ZoneClassRow["floorHeights"]>;
  const cp = (stored.constructionAedPerSqftBua ?? {}) as Partial<ZoneClassRow["constructionAedPerSqftBua"]>;
  return {
    letter,
    name: typeof stored.name === "string" && stored.name ? stored.name : def.name,
    description: typeof stored.description === "string" ? stored.description : def.description,
    locations: Array.isArray(stored.locations)
      ? stored.locations.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      : def.locations,
    typologyMix: sanitizeKeyedNumbers(stored.typologyMix, def.typologyMix),
    avgAreaSqft: sanitizeKeyedRanges(stored.avgAreaSqft, def.avgAreaSqft),
    salePriceAedPerSqft: sanitizeKeyedRanges(stored.salePriceAedPerSqft, def.salePriceAedPerSqft),
    balconyPctOfNsa: isNum(stored.balconyPctOfNsa) && stored.balconyPctOfNsa >= 0 && stored.balconyPctOfNsa < 1
      ? stored.balconyPctOfNsa
      : def.balconyPctOfNsa,
    parkingAreaPerCarSqft: isNum(stored.parkingAreaPerCarSqft) && stored.parkingAreaPerCarSqft > 0
      ? stored.parkingAreaPerCarSqft
      : def.parkingAreaPerCarSqft,
    designPriceAedPerSqftGfa: isNum(stored.designPriceAedPerSqftGfa) && stored.designPriceAedPerSqftGfa >= 0
      ? stored.designPriceAedPerSqftGfa
      : def.designPriceAedPerSqftGfa,
    floorHeights: {
      basement: isNum(fh.basement) && fh.basement > 0 ? fh.basement : def.floorHeights.basement,
      ground: isNum(fh.ground) && fh.ground > 0 ? fh.ground : def.floorHeights.ground,
      podium: isNum(fh.podium) && fh.podium > 0 ? fh.podium : def.floorHeights.podium,
      firstFloor: isNum(fh.firstFloor) && fh.firstFloor > 0 ? fh.firstFloor : def.floorHeights.firstFloor,
      typical: isNum(fh.typical) && fh.typical > 0 ? fh.typical : def.floorHeights.typical,
    },
    constructionAedPerSqftBua: {
      lowRise: isRange(cp.lowRise) ? cp.lowRise : def.constructionAedPerSqftBua.lowRise,
      midRise: isRange(cp.midRise) ? cp.midRise : def.constructionAedPerSqftBua.midRise,
      highRise: isRange(cp.highRise) ? cp.highRise : def.constructionAedPerSqftBua.highRise,
      superHigh: isRange(cp.superHigh) ? cp.superHigh : def.constructionAedPerSqftBua.superHigh,
      superHigh180: isRange(cp.superHigh180) ? cp.superHigh180 : def.constructionAedPerSqftBua.superHigh180,
      superHigh270: isRange(cp.superHigh270) ? cp.superHigh270 : def.constructionAedPerSqftBua.superHigh270,
      superHigh360min: isNum(cp.superHigh360min) && cp.superHigh360min > 0
        ? cp.superHigh360min
        : def.constructionAedPerSqftBua.superHigh360min,
    },
  };
}

/**
 * Editable, localStorage-backed copy of the Dubai class library. Shared across
 * every project — it lives outside the per-project Zustand store on purpose.
 */
export function useZoneLibrary() {
  const [library, setLibrary] = useState<Record<ZoneClass, ZoneClassRow>>(DEFAULT_ZONE_CLASSES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<ZoneClass, Partial<ZoneClassRow>>;
        // Deep-sanitise each stored row: any malformed field (empty mix,
        // missing area ranges, wrong types...) falls back to the seed value
        // instead of shadowing it. See sanitizeRow above for why.
        const merged = { ...DEFAULT_ZONE_CLASSES };
        for (const letter of Object.keys(DEFAULT_ZONE_CLASSES) as ZoneClass[]) {
          merged[letter] = sanitizeRow(letter, parsed[letter]);
        }
        // `locations` is a whole-array field, so the shallow merge above makes
        // a saved snapshot permanently shadow any zone we add to the defaults
        // later (e.g. the Abu Dhabi seed) — the user would never see it,
        // however many times we ship it, because their stored array simply
        // doesn't have it and the merge never looks inside the array. Backfill
        // any default zone that isn't anywhere in the user's saved library yet
        // into whichever class the current code assigns it to, without
        // touching zones they've already customised (moved, renamed, removed).
        const known = new Set(
          (Object.keys(DEFAULT_ZONE_CLASSES) as ZoneClass[]).flatMap((l) => merged[l].locations),
        );
        for (const letter of Object.keys(DEFAULT_ZONE_CLASSES) as ZoneClass[]) {
          const missing = DEFAULT_ZONE_CLASSES[letter].locations.filter((loc) => !known.has(loc));
          if (missing.length > 0) {
            merged[letter] = { ...merged[letter], locations: [...merged[letter].locations, ...missing] };
            missing.forEach((loc) => known.add(loc));
          }
        }
        setLibrary(merged);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Record<ZoneClass, ZoneClassRow>) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setLibrary(next);
  }, []);

  const updateClass = useCallback(
    (letter: ZoneClass, partial: Partial<ZoneClassRow>) => {
      const cur = library[letter];
      const next = { ...library, [letter]: { ...cur, ...partial } };
      persist(next);
    },
    [library, persist],
  );

  const resetAll = useCallback(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setLibrary(DEFAULT_ZONE_CLASSES);
  }, []);

  const resetClass = useCallback(
    (letter: ZoneClass) => {
      const next = { ...library, [letter]: DEFAULT_ZONE_CLASSES[letter] };
      persist(next);
    },
    [library, persist],
  );

  return { library, hydrated, updateClass, resetAll, resetClass };
}
