import type { Point } from "./geom";
import { isCounterClockwise, polygonArea, polygonCentroid } from "./geom";

/*
 * The real surroundings of a plot from OpenStreetMap: neighbouring buildings
 * (with their heights), streets and water, in metres around the plot.
 *
 * Frames:
 *   - local: metres east (x) and north (y) of the plot's location.
 *   - plan:  the drawing's metres (x right, y up), in which true north points
 *            `northDeg` clockwise from +y — the same convention as the sun
 *            study. The plot centroid sits on the location.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/* -------------------------------------------------------------------------- */
/*                               Coordinates                                  */
/* -------------------------------------------------------------------------- */

const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;

/**
 * Reads a location typed or pasted by the user: decimal degrees
 * ("25.1865, 55.2640"), degrees-minutes-seconds (25°11'11.4"N 55°15'50.4"E)
 * or a Google Maps link. Null when nothing valid is found.
 */
export function parseLatLng(text: string): LatLng | null {
  const s = text.trim();
  if (!s) return null;
  const valid = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;

  // Google Maps links: the pin (!3d…!4d…) wins over the map centre (@lat,lng).
  const pin = s.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  if (pin) return valid(parseFloat(pin[1]), parseFloat(pin[2]));
  const at = s.match(new RegExp(`@(${NUM}),\\s*(${NUM})`));
  if (at) return valid(parseFloat(at[1]), parseFloat(at[2]));
  const q = s.match(new RegExp(`[?&](?:q|query|ll|center|destination)=(${NUM})(?:,|%2C)\\s*(${NUM})`, "i"));
  if (q) return valid(parseFloat(q[1]), parseFloat(q[2]));

  // Degrees, minutes, seconds with hemisphere letters.
  const dms = s.match(
    /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([NS])[\s,]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')?\s*([EW])/i,
  );
  if (dms) {
    const deg = (d: string, m: string, sec: string, h: string) =>
      (parseFloat(d) + parseFloat(m) / 60 + parseFloat(sec) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
    return valid(deg(dms[1], dms[2], dms[3], dms[4]), deg(dms[5], dms[6], dms[7], dms[8]));
  }

  // Plain pair of decimals, optionally with N/E letters.
  const pair = s.match(new RegExp(`(${NUM})\\s*°?\\s*([NS])?\\s*[,;\\s]\\s*(${NUM})\\s*°?\\s*([EW])?`, "i"));
  if (pair) {
    const lat = parseFloat(pair[1]) * (pair[2] && /s/i.test(pair[2]) ? -1 : 1);
    const lng = parseFloat(pair[3]) * (pair[4] && /w/i.test(pair[4]) ? -1 : 1);
    return valid(lat, lng);
  }
  return null;
}

export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/** Rough bounds of the UAE — used to warn about swapped or mistyped coordinates. */
export function isInUae(p: LatLng): boolean {
  return p.lat > 22.4 && p.lat < 26.5 && p.lng > 51 && p.lng < 56.6;
}

/** WGS84 metres per degree of latitude and longitude at `lat`. */
function metresPerDegree(lat: number) {
  const r = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    lng: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r) + 0.118 * Math.cos(5 * r),
  };
}

/** Local east/north metres of `p` around `origin` — accurate to centimetres within a few kilometres. */
export function toLocal(origin: LatLng, p: { lat: number; lon?: number; lng?: number }): Point {
  const m = metresPerDegree(origin.lat);
  const lng = p.lng ?? p.lon ?? origin.lng;
  return { x: (lng - origin.lng) * m.lng, y: (p.lat - origin.lat) * m.lat };
}

/** Inverse of `toLocal`. */
export function fromLocal(origin: LatLng, p: Point): LatLng {
  const m = metresPerDegree(origin.lat);
  return { lat: origin.lat + p.y / m.lat, lng: origin.lng + p.x / m.lng };
}

/** Plan metres → local east/north metres. */
export function planToLocal(p: Point, centroid: Point, northDeg: number): Point {
  const t = (northDeg * Math.PI) / 180;
  const dx = p.x - centroid.x;
  const dy = p.y - centroid.y;
  return { x: dx * Math.cos(t) - dy * Math.sin(t), y: dx * Math.sin(t) + dy * Math.cos(t) };
}

/** Local east/north metres → plan metres. */
export function localToPlan(p: Point, centroid: Point, northDeg: number): Point {
  const t = (northDeg * Math.PI) / 180;
  return {
    x: centroid.x + p.x * Math.cos(t) + p.y * Math.sin(t),
    y: centroid.y - p.x * Math.sin(t) + p.y * Math.cos(t),
  };
}

/* -------------------------------------------------------------------------- */
/*                               Overpass API                                 */
/* -------------------------------------------------------------------------- */

const ROAD_WIDTH: Record<string, number> = {
  motorway: 24,
  trunk: 20,
  primary: 15,
  secondary: 12,
  tertiary: 10,
  motorway_link: 8,
  trunk_link: 8,
  primary_link: 7,
  secondary_link: 7,
  tertiary_link: 7,
  unclassified: 7,
  residential: 7,
  living_street: 6,
  service: 5,
};

/** Latitude/longitude box around a point — Overpass answers bbox queries much faster than `around`. */
export function bboxAround(center: LatLng, radiusM: number) {
  const m = metresPerDegree(center.lat);
  const dLat = radiusM / m.lat;
  const dLng = radiusM / m.lng;
  return { south: center.lat - dLat, west: center.lng - dLng, north: center.lat + dLat, east: center.lng + dLng };
}

/** Overpass QL for buildings, streets and water around the plot. */
export function overpassQuery(center: LatLng, radiusM: number): string {
  const b = bboxAround(center, radiusM);
  const bbox = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(6)).join(",");
  const roads = Object.keys(ROAD_WIDTH).join("|");
  return [
    `[out:json][timeout:60][bbox:${bbox}];`,
    "(",
    'way["building"];',
    'relation["building"];',
    'way["building:part"];',
    'relation["building:part"];',
    `way["highway"~"^(${roads})$"];`,
    'way["natural"="water"];',
    'relation["natural"="water"];',
    'way["waterway"="riverbank"];',
    'way["landuse"="basin"];',
    ");",
    "out geom qt;",
  ].join("");
}

/**
 * Overpass reports a query that ran out of time or memory as a "remark" in an
 * otherwise normal answer — with no or partial data. Treat it as a failure.
 */
export function overpassFailure(json: unknown): string | null {
  const remark = (json as { remark?: unknown } | null)?.remark;
  if (typeof remark === "string" && /error|timed out|out of memory/i.test(remark)) return remark;
  if (!Array.isArray((json as { elements?: unknown } | null)?.elements)) return "Unexpected answer from OpenStreetMap";
  return null;
}

/** A building (or building part) extruded between `base` and `top` metres. */
export interface ContextBuilding {
  outer: Point[];
  holes: Point[][];
  base: number;
  top: number;
  /** OSM has no height or levels for it — the height is a default. */
  estimated: boolean;
}

export interface ContextRoad {
  points: Point[];
  width: number;
}

export interface ContextArea {
  outer: Point[];
  holes: Point[][];
}

/** Neighbouring buildings, streets and water, in local metres around the location. */
export interface SiteContext {
  buildings: ContextBuilding[];
  roads: ContextRoad[];
  water: ContextArea[];
}

type Tags = Record<string, string>;
interface OsmGeomPoint {
  lat: number;
  lon: number;
}
interface OsmWay {
  type: "way";
  id: number;
  tags?: Tags;
  geometry?: OsmGeomPoint[];
}
interface OsmRelation {
  type: "relation";
  id: number;
  tags?: Tags;
  members?: { type: string; role?: string; geometry?: OsmGeomPoint[] }[];
}
type OsmElement = OsmWay | OsmRelation | { type: string; id: number; tags?: Tags };

/** Storey height used to turn OSM `building:levels` into metres. */
export const LEVEL_M = 3.3;

/** Reads "45", "45 m", "45.5m" or "150 ft" as metres. */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().replace(",", ".").match(/^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] && /^(ft|feet|')$/i.test(m[2]) ? n * 0.3048 : n;
}

function levels(v: string | undefined): number | null {
  const n = v ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Base and top of a building from its tags, with a sensible default when OSM has neither height nor levels. */
export function buildingHeights(tags: Tags): { base: number; top: number; estimated: boolean } {
  const lv = levels(tags["building:levels"]);
  const roofLv = levels(tags["roof:levels"]) ?? 0;
  let top = parseLength(tags.height);
  if (top === null && lv !== null) top = (lv + roofLv) * LEVEL_M;
  const minLv = levels(tags["building:min_level"]);
  const base = Math.max(0, parseLength(tags.min_height) ?? (minLv !== null ? minLv * LEVEL_M : 0));
  let estimated = false;
  if (top === null || top <= 0) {
    estimated = true;
    const kind = tags.building ?? tags["building:part"] ?? "yes";
    if (/^(roof|carport|canopy)$/.test(kind)) top = 5;
    else if (/^(house|detached|villa|bungalow|semidetached_house|terrace|garage|garages|shed|hut|cabin|kiosk)$/.test(kind)) top = 7;
    else if (/^(apartments|residential|hotel|office|commercial|retail|mixed_use)$/.test(kind)) top = 15;
    else top = 9;
  }
  return { base, top: Math.max(top, base + 1), estimated };
}

function wayPoints(geom: OsmGeomPoint[] | undefined, origin: LatLng): Point[] {
  return (geom ?? []).filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon)).map((g) => toLocal(origin, g));
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

/** A closed way's ring without the repeated closing point, or null if it isn't a usable ring. */
function closedRing(pts: Point[]): Point[] | null {
  if (pts.length < 4 || !same(pts[0], pts[pts.length - 1])) return null;
  const ring = pts.slice(0, -1);
  return polygonArea(ring) > 0.5 ? ring : null;
}

/** Joins multipolygon member ways end to end into closed rings. */
export function assembleRings(segments: Point[][]): Point[][] {
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Point[][] = [];
  while (pool.length) {
    let ring = pool.shift()!;
    for (let guard = 0; !same(ring[0], ring[ring.length - 1]) && guard < 10000; guard++) {
      const end = ring[ring.length - 1];
      const i = pool.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) break;
      const s = pool.splice(i, 1)[0];
      ring = ring.concat((same(s[0], end) ? s : s.slice().reverse()).slice(1));
    }
    const closed = closedRing(ring);
    if (closed) rings.push(closed);
  }
  return rings;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Outer rings of a multipolygon relation, each with the inner rings that fall inside it. */
function relationAreas(rel: OsmRelation, origin: LatLng): ContextArea[] {
  const members = rel.members ?? [];
  const outers = assembleRings(members.filter((m) => m.type === "way" && m.role !== "inner").map((m) => wayPoints(m.geometry, origin)));
  const inners = assembleRings(members.filter((m) => m.type === "way" && m.role === "inner").map((m) => wayPoints(m.geometry, origin)));
  return outers.map((outer) => ({ outer, holes: inners.filter((h) => pointInPolygon(h[0], outer)) }));
}

function elementAreas(el: OsmElement, origin: LatLng): ContextArea[] {
  if (el.type === "way") {
    const ring = closedRing(wayPoints((el as OsmWay).geometry, origin));
    return ring ? [{ outer: ring, holes: [] }] : [];
  }
  if (el.type === "relation") return relationAreas(el as OsmRelation, origin);
  return [];
}

/** Turns an Overpass JSON response into buildings, streets and water around `origin`. */
export function parseOverpass(json: unknown, origin: LatLng): SiteContext {
  const elements: OsmElement[] = Array.isArray((json as { elements?: unknown })?.elements)
    ? ((json as { elements: OsmElement[] }).elements)
    : [];
  const outlines: ContextBuilding[] = [];
  const parts: ContextBuilding[] = [];
  const roads: ContextRoad[] = [];
  const water: ContextArea[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags.building || tags["building:part"]) {
      if (tags.building === "no" || tags["building:part"] === "no") continue;
      if (/^(construction|proposed|demolished|destroyed|razed)$/.test(tags.building ?? "")) continue;
      const h = buildingHeights(tags);
      const target = tags["building:part"] ? parts : outlines;
      for (const a of elementAreas(el, origin)) target.push({ ...a, ...h });
    } else if (tags.highway && el.type === "way") {
      if (tags.area === "yes" || tags.tunnel === "yes" || tags.tunnel === "building_passage") continue;
      const points = wayPoints((el as OsmWay).geometry, origin);
      const width = ROAD_WIDTH[tags.highway];
      if (points.length >= 2 && width) roads.push({ points, width: tags.lanes ? Math.max(width, parseFloat(tags.lanes) * 3.4 || width) : width });
    } else if (tags.natural === "water" || tags.waterway === "riverbank" || tags.landuse === "basin") {
      water.push(...elementAreas(el, origin));
    }
  }

  // Simple 3D Buildings: when an outline is split into parts, the parts carry
  // the shape and the outline is not drawn.
  const buildings = outlines
    .filter((b) => !parts.some((p) => pointInPolygon(polygonCentroid(p.outer), b.outer)))
    .concat(parts);
  return { buildings, roads, water };
}

/**
 * Drops the buildings standing on the plot (they make way for the scheme) —
 * any building with a corner inside the plot, or covering one of its corners.
 */
export function withoutPlot(ctx: SiteContext, plotLocal: Point[]): SiteContext {
  return { ...ctx, buildings: ctx.buildings.filter((b) => !standsOnPlot(b, plotLocal)) };
}

/** True when a building overlaps the plot (both in local metres). */
export function standsOnPlot(b: ContextBuilding, plotLocal: Point[]): boolean {
  if (plotLocal.length < 3) return false;
  return (
    b.outer.some((p) => pointInPolygon(p, plotLocal)) ||
    plotLocal.some((p) => pointInPolygon(p, b.outer)) ||
    pointInPolygon(polygonCentroid(b.outer), plotLocal)
  );
}

/** Counter-clockwise copy of a ring (three.js shapes expect a consistent winding). */
export function ccw(ring: Point[]): Point[] {
  return isCounterClockwise(ring) ? ring : ring.slice().reverse();
}
