import {
  type Point,
  polygonArea,
  polygonBBox,
  scalePolygon,
  scalePolygonToArea,
  translatePolygon,
} from "./geom";

export type MassingShape =
  | "block"
  | "podiumTower"
  | "courtyard"
  | "twinTowers"
  | "stepped"
  | "lShape"
  | "uShape";
export type TowerPosition = "C" | "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type CornerPosition = "NE" | "NW" | "SE" | "SW";
export type SidePosition = "N" | "S" | "E" | "W";

export interface Volume {
  polygon: Point[];
  hole?: Point[];
  fromY: number;
  toY: number;
}

export interface MassingResult {
  volumes: Volume[];
  totalGFA: number;
  topY: number;
  /** Footprint that contributed to floor lines (used to draw level rings). Falls back to first volume. */
  primaryFootprint: Point[];
}

export interface MassingInputs {
  buildable: Point[];
  effFloors: number;
  effFloorArea: number;
  floorHeight: number;
  shape: MassingShape;
  podiumFloors: number;
  podiumCoverage: number;
  towerCoverage: number;
  towerPosition: TowerPosition;
  courtyardRatio: number;
  twinSeparation: number;
  twinCoverage: number;
  steppedSteps: number;
  steppedShrink: number;
  lNotchPosition: CornerPosition;
  lNotchRatio: number;
  uOpening: SidePosition;
  uArmRatio: number;
  uNotchDepth: number;
}

export function buildMassing(i: MassingInputs): MassingResult {
  const empty: MassingResult = { volumes: [], totalGFA: 0, topY: 0, primaryFootprint: [] };
  if (i.buildable.length < 3 || i.effFloors <= 0) return empty;

  const buildableArea = polygonArea(i.buildable);
  const totalH = i.effFloors * i.floorHeight;

  if (i.shape === "block") {
    const area = Math.min(Math.max(0, i.effFloorArea), buildableArea);
    if (area < 1) return empty;
    const poly = scalePolygonToArea(i.buildable, area);
    return {
      volumes: [{ polygon: poly, fromY: 0, toY: totalH }],
      totalGFA: area * i.effFloors,
      topY: totalH,
      primaryFootprint: poly,
    };
  }

  if (i.shape === "podiumTower") {
    const podFloors = Math.max(0, Math.min(Math.round(i.podiumFloors), i.effFloors));
    const towerFloors = i.effFloors - podFloors;

    const podArea = Math.min(buildableArea * clamp01(i.podiumCoverage), buildableArea);
    const towerArea = Math.min(buildableArea * clamp01(i.towerCoverage), buildableArea);

    const podiumPoly = podArea > 1 ? scalePolygonToArea(i.buildable, podArea) : [];
    const towerCentered = towerArea > 1 ? scalePolygonToArea(i.buildable, towerArea) : [];
    const towerPoly = towerCentered.length >= 3 ? placeInsideBuildable(towerCentered, i.buildable, i.towerPosition) : [];

    const podH = podFloors * i.floorHeight;
    const volumes: Volume[] = [];
    if (podFloors > 0 && podiumPoly.length >= 3) {
      volumes.push({ polygon: podiumPoly, fromY: 0, toY: podH });
    }
    if (towerFloors > 0 && towerPoly.length >= 3) {
      volumes.push({ polygon: towerPoly, fromY: podH, toY: totalH });
    }
    return {
      volumes,
      totalGFA: podFloors * podArea + towerFloors * towerArea,
      topY: totalH,
      primaryFootprint: towerPoly.length >= 3 ? towerPoly : podiumPoly,
    };
  }

  if (i.shape === "courtyard") {
    const ratio = Math.max(0, Math.min(0.6, i.courtyardRatio));
    // User's effFloorArea is the NET (outer minus hole). Solve for outer area:
    // net = outer * (1 - ratio)  =>  outer = net / (1 - ratio)
    let outerArea = i.effFloorArea / Math.max(0.4, 1 - ratio);
    outerArea = Math.min(outerArea, buildableArea);
    if (outerArea < 1) return empty;
    const outer = scalePolygonToArea(i.buildable, outerArea);
    const hole = ratio > 0.005 ? scalePolygon(outer, Math.sqrt(ratio)) : undefined;
    const netArea = outerArea - (hole ? polygonArea(hole) : 0);
    return {
      volumes: [{ polygon: outer, hole, fromY: 0, toY: totalH }],
      totalGFA: netArea * i.effFloors,
      topY: totalH,
      primaryFootprint: outer,
    };
  }

  if (i.shape === "twinTowers") {
    const eachArea = Math.min(buildableArea * clamp01(i.twinCoverage), buildableArea / 2.2);
    if (eachArea < 1) return empty;
    const each = scalePolygonToArea(i.buildable, eachArea);
    const sep = Math.max(0, i.twinSeparation);
    const t1 = translatePolygon(each, sep / 2, 0);
    const t2 = translatePolygon(each, -sep / 2, 0);
    return {
      volumes: [
        { polygon: t1, fromY: 0, toY: totalH },
        { polygon: t2, fromY: 0, toY: totalH },
      ],
      totalGFA: 2 * eachArea * i.effFloors,
      topY: totalH,
      primaryFootprint: t1,
    };
  }

  if (i.shape === "stepped") {
    const steps = Math.max(2, Math.min(8, Math.round(i.steppedSteps)));
    const shrink = Math.max(0.02, Math.min(0.5, i.steppedShrink));
    const baseArea = Math.min(Math.max(0, i.effFloorArea), buildableArea);
    if (baseArea < 1) return empty;
    const floorsPerStep = Math.max(1, Math.floor(i.effFloors / steps));
    const volumes: Volume[] = [];
    let totalGFA = 0;
    let floorsUsed = 0;
    for (let s = 0; s < steps; s++) {
      const stepArea = baseArea * Math.pow(1 - shrink, s);
      if (stepArea < 1) break;
      const stepPoly = scalePolygonToArea(i.buildable, stepArea);
      const stepFloors = s === steps - 1 ? Math.max(1, i.effFloors - floorsUsed) : floorsPerStep;
      if (stepFloors <= 0) break;
      const fromY = floorsUsed * i.floorHeight;
      const toY = (floorsUsed + stepFloors) * i.floorHeight;
      volumes.push({ polygon: stepPoly, fromY, toY });
      totalGFA += stepArea * stepFloors;
      floorsUsed += stepFloors;
      if (floorsUsed >= i.effFloors) break;
    }
    return {
      volumes,
      totalGFA,
      topY: floorsUsed * i.floorHeight,
      primaryFootprint: volumes[0]?.polygon ?? [],
    };
  }

  if (i.shape === "lShape") {
    const ratio = Math.max(0.05, Math.min(0.6, i.lNotchRatio));
    const lPoly = lShapePolygon(i.buildable, ratio, i.lNotchPosition);
    if (lPoly.length < 3) return empty;
    const targetArea = Math.min(Math.max(0, i.effFloorArea), polygonArea(lPoly));
    if (targetArea < 1) return empty;
    const scaled = scalePolygonToArea(lPoly, targetArea);
    return {
      volumes: [{ polygon: scaled, fromY: 0, toY: totalH }],
      totalGFA: polygonArea(scaled) * i.effFloors,
      topY: totalH,
      primaryFootprint: scaled,
    };
  }

  if (i.shape === "uShape") {
    const arm = Math.max(0.1, Math.min(0.5, i.uArmRatio));
    const depth = Math.max(0.2, Math.min(0.9, i.uNotchDepth));
    const uPoly = uShapePolygon(i.buildable, arm, depth, i.uOpening);
    if (uPoly.length < 3) return empty;
    const targetArea = Math.min(Math.max(0, i.effFloorArea), polygonArea(uPoly));
    if (targetArea < 1) return empty;
    const scaled = scalePolygonToArea(uPoly, targetArea);
    return {
      volumes: [{ polygon: scaled, fromY: 0, toY: totalH }],
      totalGFA: polygonArea(scaled) * i.effFloors,
      topY: totalH,
      primaryFootprint: scaled,
    };
  }

  return empty;
}

/** Build an L-shape polygon centered at the buildable centroid, sized to the buildable bbox. */
function lShapePolygon(buildable: Point[], ratio: number, position: CornerPosition): Point[] {
  const bb = polygonBBox(buildable);
  const W = bb.w;
  const D = bb.h;
  if (W <= 0 || D <= 0) return [];
  const Wx = W * ratio;
  const Dy = D * ratio;
  // Default L with notch at NE corner of a [0,0]..[W,D] rectangle, CCW
  let pts: Point[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: D - Dy },
    { x: W - Wx, y: D - Dy },
    { x: W - Wx, y: D },
    { x: 0, y: D },
  ];
  // Mirror for other corners
  if (position === "NW") pts = pts.map((p) => ({ x: W - p.x, y: p.y }));
  if (position === "SE") pts = pts.map((p) => ({ x: p.x, y: D - p.y }));
  if (position === "SW") pts = pts.map((p) => ({ x: W - p.x, y: D - p.y }));
  // Center on the buildable centroid
  const c = polygonCentroidLite(buildable);
  return pts.map((p) => ({ x: p.x - W / 2 + c.x, y: p.y - D / 2 + c.y }));
}

/** Build a U-shape polygon centered at the buildable centroid. `opening` = side that is open. */
function uShapePolygon(buildable: Point[], arm: number, depth: number, opening: SidePosition): Point[] {
  const bb = polygonBBox(buildable);
  const W = bb.w;
  const D = bb.h;
  if (W <= 0 || D <= 0) return [];
  // Default opening = N (top side opens), arms vertical, base on the south.
  // Notch is a rectangle from (W*arm, 0) to (W*(1-arm), D*depth) — wait need to rethink.
  // Actually with N opening: arms go from south up, notch eats from the north.
  // Polygon CCW (bottom-left start):
  const aw = W * arm;
  const dh = D * depth;
  let pts: Point[] = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: D },
    { x: W - aw, y: D },
    { x: W - aw, y: D - dh },
    { x: aw, y: D - dh },
    { x: aw, y: D },
    { x: 0, y: D },
  ];
  // Rotate for other openings
  if (opening === "S") pts = pts.map((p) => ({ x: p.x, y: D - p.y }));
  if (opening === "E") pts = pts.map((p) => ({ x: p.y * (W / D), y: p.x * (D / W) })); // rotate 90° CW with rescale
  if (opening === "W") {
    pts = pts.map((p) => ({ x: p.y * (W / D), y: p.x * (D / W) }));
    pts = pts.map((p) => ({ x: W - p.x, y: p.y }));
  }
  const c = polygonCentroidLite(buildable);
  return pts.map((p) => ({ x: p.x - W / 2 + c.x, y: p.y - D / 2 + c.y }));
}

function polygonCentroidLite(poly: Point[]): Point {
  // Bounding-box centroid is good enough here — buildMassing only uses it to centre the L/U.
  const bb = polygonBBox(poly);
  return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
}

function placeInsideBuildable(towerPoly: Point[], buildable: Point[], position: TowerPosition): Point[] {
  if (position === "C") return towerPoly;
  const tBbox = polygonBBox(towerPoly);
  const bBbox = polygonBBox(buildable);
  let dx = 0;
  let dy = 0;
  if (position.includes("E")) dx = bBbox.maxX - tBbox.maxX;
  else if (position.includes("W")) dx = bBbox.minX - tBbox.minX;
  if (position.includes("N")) dy = bBbox.maxY - tBbox.maxY;
  else if (position.includes("S")) dy = bBbox.minY - tBbox.minY;
  return translatePolygon(towerPoly, dx, dy);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
