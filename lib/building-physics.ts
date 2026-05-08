/**
 * Indicative building-physics analyses inspired by OMRT's deliverable list:
 *
 *   - Sky exposure (% of sky dome each façade panel sees, considering
 *     neighbouring buildings + self-shading from upper massing)
 *   - View quality on a landmark (% of façade with line-of-sight to a
 *     selected landmark point)
 *   - PV potential (kWp installable + annual yield from roof and south-
 *     facing façades, given project latitude)
 *
 * All analyses are first-order approximations meant for early-stage massing
 * studies. They run client-side with simple AABB ray tests — no raytracing,
 * no thermal/optical simulation.
 *
 * Coordinate frame (world):
 *   X = east, Y = up, Z = south (positive Z points away from north).
 *   Project building volumes carry polygons in (px, py) shape coordinates
 *   that the 3D scene rotates -π/2 around X. We project them to world via
 *   (X, Z) = (px, -py).
 */

import type { CustomNeighbor } from "./types";
import type { Volume } from "./massing";
import { polygonArea, polygonBBox, type Point } from "./geom";

/* -------------------------------------------------------------------------- */
/*                                Geometry types                              */
/* -------------------------------------------------------------------------- */

interface Vec3 { x: number; y: number; z: number }

/** Axis-aligned box in world frame. */
export interface Box {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  zMin: number; zMax: number;
}

/** A facade panel — sample point on the outside of a building wall. */
export interface FacadePanel {
  /** World-space sample point, slightly offset along the outward normal. */
  pos: Vec3;
  /** Outward-facing unit normal (Y component = 0 for vertical walls). */
  normal: Vec3;
  /** Approximate panel area (m²) — used to weight aggregate stats. */
  areaM2: number;
  /** Panel width along the wall edge (m). */
  widthM: number;
  /** Panel height along Y (m). */
  heightM: number;
  /** Compass orientation derived from normal (0 = N, 90 = E, 180 = S, 270 = W). */
  orientationDeg: number;
}

/* -------------------------------------------------------------------------- */
/*                          Convert geometry to AABBs                         */
/* -------------------------------------------------------------------------- */

/** Project building volumes → world-frame AABBs. */
export function projectBoxes(volumes: Volume[]): Box[] {
  return volumes.map((v) => {
    const bbox = polygonBBox(v.polygon);
    return {
      xMin: bbox.minX, xMax: bbox.maxX,
      // shape Y → world -Z, so the polygon's [minY, maxY] becomes [zMin, zMax] = [-maxY, -minY]
      zMin: -bbox.maxY, zMax: -bbox.minY,
      yMin: v.fromY, yMax: v.toY,
    };
  });
}

/** OSM neighbour polygon (already in world XZ via lat-lng projection) → AABB. */
export function osmBuildingBox(polygon: Point[], height: number): Box {
  const bbox = polygonBBox(polygon);
  return {
    xMin: bbox.minX, xMax: bbox.maxX,
    zMin: -bbox.maxY, zMax: -bbox.minY,
    yMin: 0, yMax: height,
  };
}

/** Manually defined neighbour (rotated rectangle) → world AABB(s). */
export function customNeighborBoxes(n: CustomNeighbor): Box[] {
  const out: Box[] = [];
  const cos = Math.cos((n.rotationDeg * Math.PI) / 180);
  const sin = Math.sin((n.rotationDeg * Math.PI) / 180);
  const corners = (cx: number, cz: number, w: number, d: number): { x: number; z: number }[] => {
    const hx = w / 2, hz = d / 2;
    return [
      { x: -hx, z: -hz }, { x: hx, z: -hz },
      { x: hx, z: hz }, { x: -hx, z: hz },
    ].map((p) => ({
      x: cx + p.x * cos - p.z * sin,
      z: cz + p.x * sin + p.z * cos,
    }));
  };
  // Podium
  {
    const c = corners(n.centerX, n.centerZ, n.widthM, n.depthM);
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    out.push({ xMin, xMax, zMin, zMax, yMin: 0, yMax: n.heightM });
  }
  // Tower (offset is in the rotated frame)
  if (n.tower) {
    const offsetX = n.tower.offsetXM ?? 0;
    const offsetZ = n.tower.offsetZM ?? 0;
    const towerCx = n.centerX + offsetX * cos - offsetZ * sin;
    const towerCz = n.centerZ + offsetX * sin + offsetZ * cos;
    const c = corners(towerCx, towerCz, n.tower.widthM, n.tower.depthM);
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    out.push({ xMin, xMax, zMin, zMax, yMin: n.heightM, yMax: n.heightM + n.tower.heightM });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                              Ray / box helpers                             */
/* -------------------------------------------------------------------------- */

/**
 * Slab ray-AABB. Returns the smallest positive t at which the ray enters the
 * box, or null if it misses.
 */
export function rayHitsBox(o: Vec3, d: Vec3, b: Box, tMax = Infinity): boolean {
  let tMin = 0;
  let tMaxRay = tMax;
  for (const ax of ["x", "y", "z"] as const) {
    const od = ax === "x" ? d.x : ax === "y" ? d.y : d.z;
    const oo = ax === "x" ? o.x : ax === "y" ? o.y : o.z;
    const lo = ax === "x" ? b.xMin : ax === "y" ? b.yMin : b.zMin;
    const hi = ax === "x" ? b.xMax : ax === "y" ? b.yMax : b.zMax;
    if (Math.abs(od) < 1e-9) {
      if (oo < lo || oo > hi) return false;
    } else {
      const t1 = (lo - oo) / od;
      const t2 = (hi - oo) / od;
      const tNear = Math.min(t1, t2);
      const tFar = Math.max(t1, t2);
      if (tNear > tMin) tMin = tNear;
      if (tFar < tMaxRay) tMaxRay = tFar;
      if (tMin > tMaxRay) return false;
    }
  }
  return tMin > 1e-4 && tMin < tMax;
}

/** Spherical Fibonacci hemisphere — N points uniformly on the upper hemisphere
 *  (Y > 0). Each direction is a unit vector. */
function fibonacciHemisphere(n: number): Vec3[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const cy = 1 - (i + 0.5) / n;       // y in (0, 1)
    const r = Math.sqrt(1 - cy * cy);
    const theta = 2 * Math.PI * i / phi;
    out.push({ x: r * Math.cos(theta), y: cy, z: r * Math.sin(theta) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                            Facade panel sampling                           */
/* -------------------------------------------------------------------------- */

const NORMAL_OFFSET_M = 0.25;

/**
 * Walk every external edge of every project volume and place panels of
 * approximately `panelSizeM × panelSizeM`. Panels are slightly offset along
 * the wall's outward normal so rays don't hit their own wall.
 */
export function sampleFacadePanels(volumes: Volume[], panelSizeM: number): FacadePanel[] {
  const panels: FacadePanel[] = [];
  for (const v of volumes) {
    const verts = v.polygon;
    const ccw = isPolygonCCW(verts);
    const fromY = v.fromY;
    const height = v.toY - v.fromY;
    if (height <= 0 || verts.length < 3) continue;
    const verticalSteps = Math.max(1, Math.round(height / panelSizeM));
    const dY = height / verticalSteps;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 0.05) continue;
      // Outward normal in world XZ. Polygon (x, y) → world (x, -y).
      // Edge tangent (world) = (ex, -ey). Outward normal for a CCW polygon =
      // (-tangentZ, +tangentX) normalised; for CW it's flipped.
      const tx = ex;
      const tz = -ey;
      const sign = ccw ? 1 : -1;
      const nx = -tz * sign / len;
      const nz = tx * sign / len;
      const horizontalSteps = Math.max(1, Math.round(len / panelSizeM));
      const dE = len / horizontalSteps;
      for (let h = 0; h < horizontalSteps; h++) {
        const fH = (h + 0.5) / horizontalSteps;
        const wx = a.x + ex * fH;
        const wy = a.y + ey * fH;
        // Convert (wx, wy) shape coords to (X, Z) world.
        const worldX = wx + nx * NORMAL_OFFSET_M;
        const worldZ = -wy + nz * NORMAL_OFFSET_M;
        for (let vstep = 0; vstep < verticalSteps; vstep++) {
          const cY = fromY + (vstep + 0.5) * dY;
          panels.push({
            pos: { x: worldX, y: cY, z: worldZ },
            normal: { x: nx, y: 0, z: nz },
            areaM2: dE * dY,
            widthM: dE,
            heightM: dY,
            orientationDeg: normalToCompassDeg(nx, nz),
          });
        }
      }
    }
  }
  return panels;
}

function isPolygonCCW(poly: Point[]): boolean {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return s < 0;
}

function normalToCompassDeg(nx: number, nz: number): number {
  // nx = +X (east), nz = +Z (south). Convert to compass clockwise from north.
  // World N = -Z, E = +X, S = +Z, W = -X.
  // Compass = atan2(east, north) = atan2(nx, -nz).
  const deg = (Math.atan2(nx, -nz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/* -------------------------------------------------------------------------- */
/*                            Sky exposure analysis                           */
/* -------------------------------------------------------------------------- */

export interface SkyExposureOptions {
  panelSizeM?: number;
  rayCount?: number;
}

export interface PanelValue {
  panel: FacadePanel;
  value: number;
}

export interface SkyExposureResult {
  averagePct: number;
  totalAreaM2: number;
  panelCount: number;
  pctAreaBelow25: number;
  pctAreaBelow20: number;
  byOrientation: { name: string; areaM2: number; avgPct: number }[];
  histogram: { bin: string; areaM2: number }[];
  panelValues: PanelValue[];
}

const COMPASS_OCTANTS: { name: string; from: number; to: number }[] = [
  { name: "N", from: 337.5, to: 22.5 },
  { name: "NE", from: 22.5, to: 67.5 },
  { name: "E", from: 67.5, to: 112.5 },
  { name: "SE", from: 112.5, to: 157.5 },
  { name: "S", from: 157.5, to: 202.5 },
  { name: "SW", from: 202.5, to: 247.5 },
  { name: "W", from: 247.5, to: 292.5 },
  { name: "NW", from: 292.5, to: 337.5 },
];

function octantOf(deg: number): string {
  const d = (deg + 360) % 360;
  for (const o of COMPASS_OCTANTS) {
    if (o.from < o.to ? d >= o.from && d < o.to : d >= o.from || d < o.to) return o.name;
  }
  return "N";
}

export function computeSkyExposure(
  panels: FacadePanel[],
  obstacles: Box[],
  options: SkyExposureOptions = {},
): SkyExposureResult {
  const rayCount = options.rayCount ?? 64;
  const dirs = fibonacciHemisphere(rayCount);
  let totalArea = 0;
  let weightedSum = 0;
  let areaBelow25 = 0;
  let areaBelow20 = 0;
  const byOrient = new Map<string, { area: number; weighted: number }>();
  const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const histArea = new Array<number>(bins.length - 1).fill(0);
  const panelValues: PanelValue[] = [];
  for (const panel of panels) {
    let eligible = 0;
    let unblocked = 0;
    for (const dir of dirs) {
      // Only count rays in front of the panel (outward).
      const dot = dir.x * panel.normal.x + dir.z * panel.normal.z;
      if (dot <= 0) continue;
      eligible++;
      let blocked = false;
      for (const box of obstacles) {
        if (rayHitsBox(panel.pos, dir, box)) { blocked = true; break; }
      }
      if (!blocked) unblocked++;
    }
    const exposure = eligible > 0 ? unblocked / eligible : 0;
    panelValues.push({ panel, value: exposure });
    totalArea += panel.areaM2;
    weightedSum += exposure * panel.areaM2;
    if (exposure < 0.25) areaBelow25 += panel.areaM2;
    if (exposure < 0.20) areaBelow20 += panel.areaM2;
    const oct = octantOf(panel.orientationDeg);
    const bucket = byOrient.get(oct) ?? { area: 0, weighted: 0 };
    bucket.area += panel.areaM2;
    bucket.weighted += exposure * panel.areaM2;
    byOrient.set(oct, bucket);
    let bi = Math.floor(exposure * (bins.length - 1));
    if (bi < 0) bi = 0;
    if (bi >= bins.length - 1) bi = bins.length - 2;
    histArea[bi] += panel.areaM2;
  }
  const byOrientation = COMPASS_OCTANTS.map((o) => {
    const v = byOrient.get(o.name);
    return {
      name: o.name,
      areaM2: v?.area ?? 0,
      avgPct: v && v.area > 0 ? v.weighted / v.area : 0,
    };
  }).filter((x) => x.areaM2 > 0);
  const histogram = histArea.map((a, i) => ({
    bin: `${(bins[i] * 100).toFixed(0)}-${(bins[i + 1] * 100).toFixed(0)}%`,
    areaM2: a,
  }));
  return {
    averagePct: totalArea > 0 ? weightedSum / totalArea : 0,
    totalAreaM2: totalArea,
    panelCount: panels.length,
    pctAreaBelow25: totalArea > 0 ? areaBelow25 / totalArea : 0,
    pctAreaBelow20: totalArea > 0 ? areaBelow20 / totalArea : 0,
    byOrientation,
    histogram,
    panelValues,
  };
}

/* -------------------------------------------------------------------------- */
/*                          View quality on a landmark                        */
/* -------------------------------------------------------------------------- */

export interface ViewQualityOptions {
  panelSizeM?: number;
}

export interface ViewQualityResult {
  averageViewPct: number;
  totalAreaM2: number;
  buckets: { label: string; areaM2: number; pct: number }[];
  byOrientation: { name: string; areaM2: number; avgPct: number }[];
  panelValues: PanelValue[];
}

export function computeViewQuality(
  panels: FacadePanel[],
  obstacles: Box[],
  landmark: Vec3,
): ViewQualityResult {
  let totalArea = 0;
  let withView = 0;
  const orientArea = new Map<string, { area: number; viewArea: number }>();
  // Bucket by "view fraction" — for a point-landmark this is binary (0 or 1) per
  // panel. To produce gradation, we integrate over a small angular cone around
  // the landmark by sampling a few near-by directions.
  const sampleOffsets: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 8, y: 0, z: 0 }, { x: -8, y: 0, z: 0 },
    { x: 0, y: 8, z: 0 }, { x: 0, y: -8, z: 0 },
    { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 },
    { x: 5, y: 5, z: 0 }, { x: -5, y: 5, z: 0 },
  ];
  const bucketBins = [0, 0.125, 0.25, 0.5, 1.001];
  const bucketLabels = ["<12.5%", "12.5–25%", "25–50%", ">50%"];
  const bucketArea = new Array<number>(4).fill(0);
  const panelValues: PanelValue[] = [];
  for (const panel of panels) {
    let visible = 0;
    let total = 0;
    for (const off of sampleOffsets) {
      const target = { x: landmark.x + off.x, y: landmark.y + off.y, z: landmark.z + off.z };
      const dx = target.x - panel.pos.x;
      const dy = target.y - panel.pos.y;
      const dz = target.z - panel.pos.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.5) continue;
      const dir: Vec3 = { x: dx / len, y: dy / len, z: dz / len };
      const dot = dir.x * panel.normal.x + dir.z * panel.normal.z;
      if (dot <= 0) { total++; continue; }
      let blocked = false;
      for (const box of obstacles) {
        if (rayHitsBox(panel.pos, dir, box, len)) { blocked = true; break; }
      }
      total++;
      if (!blocked) visible++;
    }
    const view = total > 0 ? visible / total : 0;
    panelValues.push({ panel, value: view });
    totalArea += panel.areaM2;
    if (view > 0) withView += panel.areaM2 * view;
    const oct = octantOf(panel.orientationDeg);
    const o = orientArea.get(oct) ?? { area: 0, viewArea: 0 };
    o.area += panel.areaM2;
    o.viewArea += panel.areaM2 * view;
    orientArea.set(oct, o);
    for (let bi = 0; bi < bucketBins.length - 1; bi++) {
      if (view >= bucketBins[bi] && view < bucketBins[bi + 1]) {
        bucketArea[bi] += panel.areaM2;
        break;
      }
    }
  }
  const buckets = bucketLabels.map((label, i) => ({
    label,
    areaM2: bucketArea[i],
    pct: totalArea > 0 ? bucketArea[i] / totalArea : 0,
  }));
  const byOrientation = COMPASS_OCTANTS.map((o) => {
    const v = orientArea.get(o.name);
    return {
      name: o.name,
      areaM2: v?.area ?? 0,
      avgPct: v && v.area > 0 ? v.viewArea / v.area : 0,
    };
  }).filter((x) => x.areaM2 > 0);
  return {
    averageViewPct: totalArea > 0 ? withView / totalArea : 0,
    totalAreaM2: totalArea,
    buckets,
    byOrientation,
    panelValues,
  };
}

/* -------------------------------------------------------------------------- */
/*                              PV potential                                  */
/* -------------------------------------------------------------------------- */

export interface PVOptions {
  /** Annual global horizontal irradiation, kWh/m²/yr. Defaults to a Dubai-like value. */
  annualGHI?: number;
  /** Panel rated efficiency (0..1). Modern monocrystalline silicon ~0.20-0.22. */
  panelEfficiency?: number;
  /** Performance ratio (0..1) — accounts for inverter, cabling, soiling, temperature. */
  performanceRatio?: number;
  /** Fraction of the gross roof area realistically usable for PV (after MEP, lifts, walkways). */
  roofUtilization?: number;
  /** Tilted-vs-horizontal yield correction for roof. Optimal tilt ~latitude → ~+5-8%. */
  roofTiltFactor?: number;
  /** Vertical-vs-horizontal yield ratio for south façade — typical ~0.65 for Dubai. */
  facadeYieldRatio?: number;
  /** Fraction of south-arc façade area realistically usable (after windows, balconies). */
  facadeUtilization?: number;
  /** Whether to include south-facing façades (S, SE, SW) on top of the roof. */
  includeFacades?: boolean;
}

export interface PVResult {
  roof: { areaM2: number; usableM2: number; kWp: number; annualKWh: number };
  facade: { areaM2: number; usableM2: number; kWp: number; annualKWh: number };
  totalKWp: number;
  totalAnnualKWh: number;
  /** Panel power density (kWp / m² of usable surface). */
  kWpPerM2: number;
  parameters: Required<PVOptions>;
}

const DUBAI_DEFAULT_GHI = 2150;
const PV_DEFAULTS: Required<PVOptions> = {
  annualGHI: DUBAI_DEFAULT_GHI,
  panelEfficiency: 0.21,
  performanceRatio: 0.80,
  roofUtilization: 0.55,
  roofTiltFactor: 1.05,
  facadeYieldRatio: 0.65,
  facadeUtilization: 0.30,
  includeFacades: true,
};

/**
 * Take the project's volumes + facade panels and estimate PV potential.
 *
 * Roof area = top face area of every volume (sum of polygon areas — note this
 * over-counts when volumes overlap vertically; for residential massing this is
 * usually fine because the topmost volume defines the roof).
 *
 * Façade contribution = panels with compass orientation in the south arc
 * (135°–225° centred on south for the northern hemisphere).
 */
export function computePVPotential(
  volumes: Volume[],
  panels: FacadePanel[],
  options: PVOptions = {},
): PVResult {
  const p = { ...PV_DEFAULTS, ...options };
  // Roof — use the top of each volume. We compute the top of the topmost volume only,
  // because in stacked massings the lower volumes' tops are partially covered by upper
  // volumes' bases. For the indicative analysis we approximate by using the area of the
  // single topmost volume.
  const topY = volumes.reduce((m, v) => Math.max(m, v.toY), 0);
  const roofArea = volumes
    .filter((v) => Math.abs(v.toY - topY) < 0.5)
    .reduce((s, v) => {
      const polyArea = Math.abs(polygonArea(v.polygon));
      const holeArea = v.hole ? Math.abs(polygonArea(v.hole)) : 0;
      return s + Math.max(0, polyArea - holeArea);
    }, 0);
  const roofUsable = roofArea * p.roofUtilization;
  const roofKWp = roofUsable * p.panelEfficiency;
  const roofKWh = roofUsable * p.annualGHI * p.panelEfficiency * p.performanceRatio * p.roofTiltFactor;
  // Façades — south arc only.
  let facadeArea = 0;
  if (p.includeFacades) {
    for (const panel of panels) {
      const o = panel.orientationDeg;
      if (o >= 112.5 && o <= 247.5) facadeArea += panel.areaM2;
    }
  }
  const facadeUsable = facadeArea * p.facadeUtilization;
  const facadeKWp = facadeUsable * p.panelEfficiency;
  const facadeKWh = facadeUsable * p.annualGHI * p.panelEfficiency * p.performanceRatio * p.facadeYieldRatio;
  const totalKWp = roofKWp + facadeKWp;
  const totalKWh = roofKWh + facadeKWh;
  const kWpPerM2 = roofUsable + facadeUsable > 0 ? totalKWp / (roofUsable + facadeUsable) : 0;
  return {
    roof: { areaM2: roofArea, usableM2: roofUsable, kWp: roofKWp, annualKWh: roofKWh },
    facade: { areaM2: facadeArea, usableM2: facadeUsable, kWp: facadeKWp, annualKWh: facadeKWh },
    totalKWp,
    totalAnnualKWh: totalKWh,
    kWpPerM2,
    parameters: p,
  };
}

/* -------------------------------------------------------------------------- */
/*                             Lat/lng helpers                                */
/* -------------------------------------------------------------------------- */

const M_PER_DEG_LAT = 111320;
function metresPerDegLng(latDeg: number) {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

/** Project a (lat, lng) pair to local world (X = east, Z = south) metres. */
export function latLngToWorld(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
): { x: number; z: number } {
  const x = (lng - originLng) * metresPerDegLng(originLat);
  const yNorth = (lat - originLat) * M_PER_DEG_LAT;
  return { x, z: -yNorth };
}
