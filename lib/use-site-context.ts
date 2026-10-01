"use client";
import { useCallback, useEffect, useState } from "react";
import { overpassFailure, overpassQuery, parseOverpass, type LatLng, type SiteContext } from "./site-context";

/** Overpass servers, tried in order: the deployment's own (NEXT_PUBLIC_OVERPASS_URL), then the public ones. */
const OWN_ENDPOINT = (process.env.NEXT_PUBLIC_OVERPASS_URL ?? "").trim();
const ENDPOINTS = [
  ...(OWN_ENDPOINT ? [OWN_ENDPOINT] : []),
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const TIMEOUT_MS = 70000;

/** One download per location and radius per browser session. */
const cache = new Map<string, Promise<SiteContext>>();

async function download(center: LatLng, radiusM: number): Promise<SiteContext> {
  const body = `data=${encodeURIComponent(overpassQuery(center, radiusM))}`;
  const problems: string[] = [];
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(res.status === 429 || res.status === 504 ? "busy" : `HTTP ${res.status}`);
      const json: unknown = await res.json();
      const failure = overpassFailure(json);
      if (failure) throw new Error(failure);
      return parseOverpass(json, center);
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "AbortError" ? "timed out" : e.message) : String(e);
      problems.push(`${new URL(url).host}: ${msg}`);
      console.warn("OpenStreetMap surroundings:", url, msg);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    problems.every((p) => /busy|timed out/.test(p))
      ? "The OpenStreetMap servers are busy right now — retry in a minute."
      : "OpenStreetMap could not be reached — check the connection and retry.",
  );
}

export type ContextStatus = "off" | "loading" | "ready" | "error";

/**
 * Neighbouring buildings, streets and water around the plot, downloaded from
 * OpenStreetMap when `enabled` and a location is set.
 */
export function useSiteContext(center: LatLng | undefined, radiusM: number, enabled: boolean) {
  const key = center && enabled ? `${center.lat.toFixed(6)},${center.lng.toFixed(6)},${Math.round(radiusM)}` : "";
  const [state, setState] = useState<{ key: string; status: ContextStatus; data: SiteContext | null; error?: string }>({
    key: "",
    status: "off",
    data: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key || !center) {
      setState({ key: "", status: "off", data: null });
      return;
    }
    let live = true;
    let job = cache.get(key);
    if (!job) {
      job = download(center, radiusM);
      cache.set(key, job);
      job.catch(() => cache.delete(key)); // a failed download can be retried
    }
    setState({ key, status: "loading", data: null });
    job.then(
      (data) => live && setState({ key, status: "ready", data }),
      (e: unknown) => live && setState({ key, status: "error", data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `center` and `radiusM` are captured by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status: state.status, data: state.data, error: state.error, retry };
}
