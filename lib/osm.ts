/**
 * Shared Overpass API client. Fetches OSM building footprints around a
 * lat/lng point, projected into local metres so the result lands in the same
 * frame the 3D scene uses.
 */

import type { Point } from "./geom";

interface OsmNode { type: "node"; id: number; lat: number; lon: number }
interface OsmWay { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> }
type OsmElement = OsmNode | OsmWay;

export interface OsmBuilding {
  id: string;
  /** Polygon in plot-local metres: x = east, y = north. */
  polygon: Point[];
  /** Height parsed from tags, fallback 9 m. */
  defaultHeight: number;
  name?: string;
}

const M_PER_DEG_LAT = 111320;
const metresPerDegLng = (latDeg: number) => 111320 * Math.cos((latDeg * Math.PI) / 180);

function latLngToLocal(lat: number, lng: number, originLat: number, originLng: number): Point {
  return {
    x: (lng - originLng) * metresPerDegLng(originLat),
    y: (lat - originLat) * M_PER_DEG_LAT,
  };
}

export async function fetchOsmBuildings(
  latitude: number,
  longitude: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<OsmBuilding[]> {
  const radius = Math.round(radiusM);
  const query = `[out:json][timeout:25];way[building](around:${radius},${latitude},${longitude});(._;>;);out;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = (await res.json()) as { elements: OsmElement[] };
  return parse(data.elements, latitude, longitude);
}

function parse(elements: OsmElement[], originLat: number, originLng: number): OsmBuilding[] {
  const nodeMap = new Map<number, OsmNode>();
  for (const el of elements) if (el.type === "node") nodeMap.set(el.id, el);
  const out: OsmBuilding[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.tags?.building) continue;
    const polygon: Point[] = [];
    for (const nid of el.nodes) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      polygon.push(latLngToLocal(n.lat, n.lon, originLat, originLng));
    }
    if (polygon.length >= 2) {
      const a = polygon[0];
      const b = polygon[polygon.length - 1];
      if (Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) polygon.pop();
    }
    if (polygon.length < 3) continue;
    const tags = el.tags;
    let height = 0;
    if (tags["height"]) {
      const n = parseFloat(tags["height"]);
      if (Number.isFinite(n)) height = n;
    }
    if (height <= 0 && tags["building:levels"]) {
      const lv = parseFloat(tags["building:levels"]);
      if (Number.isFinite(lv)) height = lv * 3.2;
    }
    if (height <= 0) height = 9;
    out.push({
      id: `osm-${el.id}`,
      polygon,
      defaultHeight: height,
      name: tags["name"],
    });
  }
  return out;
}
