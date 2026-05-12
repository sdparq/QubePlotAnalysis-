"use client";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ZONE_CLASSES,
  type ZoneClass,
  type ZoneClassRow,
} from "./zone-classes";

const STORAGE_KEY = "qube-zone-library-v1";

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
        const parsed = JSON.parse(raw) as Record<ZoneClass, ZoneClassRow>;
        // Shallow-merge with defaults so newly added fields fall back gracefully.
        const merged = { ...DEFAULT_ZONE_CLASSES };
        for (const letter of Object.keys(DEFAULT_ZONE_CLASSES) as ZoneClass[]) {
          merged[letter] = { ...DEFAULT_ZONE_CLASSES[letter], ...(parsed[letter] ?? {}) };
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
