import {
  type Point,
  polygonArea,
  polygonBBox,
  polygonDifference,
  polygonIntersection,
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
    const poly = clipToBuildable(scalePolygonToArea(i.buildable, area), i.buildable);
    if (poly.length < 3) return empty;
    return {
      volumes: [{ polygon: poly, fromY: 0, toY: totalH }],
      totalGFA: polygonArea(poly) * i.effFloors,
      topY: totalH,
      primaryFootprint: poly,
    };
  }

  if (i.shape === "podiumTower") {
    const podFloors = Math.max(0, Math.min(Math.round(i.podiumFloors), i.effFloors));
    const towerFloors = i.effFloors - podFloors;

    const podArea = Math.min(buildableArea * clamp01(i.podiumCoverage), buildableArea);
    const towerArea = Math.min(buildableArea * clamp01(i.towerCoverage), buildableArea);

    const podiumPoly = podArea > 1 ? clipToBuildable(scalePolygonToArea(i.buildable, podArea), i.buildable) : [];
    const towerCentered = towerArea > 1 ? scalePolygonToArea(i.buildable, towerArea) : [];
    const towerOffset = towerCentered.length >= 3 ? placeInsideBuildable(towerCentered, i.buildable, i.towerPosition) : [];
    const towerPoly = clipToBuildable(towerOffset, i.buildable);

    const podH = podFloors * i.floorHeight;
    const volumes: Volume[] = [];
    if (podFloors > 0 && podiumPoly.length >= 3) {
      volumes.push({ polygon: podiumPoly, fromY: 0, toY: podH });
    }
    if (towerFloors > 0 && towerPoly.length >= 3) {
      volumes.push({ polygon: towerPoly, fromY: podH, toY: totalH });
    }
    const podiumGFA = polygonArea(podiumPoly) * podFloors;
    const towerGFA = polygonArea(towerPoly) * towerFloors;
    return {
      volumes,
      totalGFA: podiumGFA + towerGFA,
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
    const outer = clipToBuildable(scalePolygonToArea(i.buildable, outerArea), i.buildable);
    if (outer.length < 3) return empty;
    const hole = ratio > 0.005 ? scalePolygon(outer, Math.sqrt(ratio)) : undefined;
    const netArea = polygonArea(outer) - (hole ? polygonArea(hole) : 0);
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
    const t1 = clipToBuildable(translatePolygon(each, sep / 2, 0), i.buildable);
    const t2 = clipToBuildable(translatePolygon(each, -sep / 2, 0), i.buildable);
    const volumes: Volume[] = [];
    if (t1.length >= 3) volumes.push({ polygon: t1, fromY: 0, toY: totalH });
    if (t2.length >= 3) volumes.push({ polygon: t2, fromY: 0, toY: totalH });
    if (volumes.length === 0) return empty;
    return {
      volumes,
      totalGFA: (polygonArea(t1) + polygonArea(t2)) * i.effFloors,
      topY: totalH,
      primaryFootprint: t1.length >= 3 ? t1 : t2,
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
      const stepPoly = clipToBuildable(scalePolygonToArea(i.buildable, stepArea), i.buildable);
      if (stepPoly.length < 3) break;
      const stepFloors = s === steps - 1 ? Math.max(1, i.effFloors - floorsUsed) : floorsPerStep;
      if (stepFloors <= 0) break;
      const fromY = floorsUsed * i.floorHeight;
      const toY = (floorsUsed + stepFloors) * i.floorHeight;
      volumes.push({ polygon: stepPoly, fromY, toY });
      totalGFA += polygonArea(stepPoly) * stepFloors;
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
    const clipped = clipToBuildable(scalePolygonToArea(lPoly, targetArea), i.buildable);
    if (clipped.length < 3) return empty;
    return {
      volumes: [{ polygon: clipped, fromY: 0, toY: totalH }],
      totalGFA: polygonArea(clipped) * i.effFloors,
      topY: totalH,
      primaryFootprint: clipped,
    };
  }

  if (i.shape === "uShape") {
    const arm = Math.max(0.1, Math.min(0.5, i.uArmRatio));
    const depth = Math.max(0.2, Math.min(0.9, i.uNotchDepth));
    const uPoly = uShapePolygon(i.buildable, arm, depth, i.uOpening);
    if (uPoly.length < 3) return empty;
    const targetArea = Math.min(Math.max(0, i.effFloorArea), polygonArea(uPoly));
    if (targetArea < 1) return empty;
    const clipped = clipToBuildable(scalePolygonToArea(uPoly, targetArea), i.buildable);
    if (clipped.length < 3) return empty;
    return {
      volumes: [{ polygon: clipped, fromY: 0, toY: totalH }],
      totalGFA: polygonArea(clipped) * i.effFloors,
      topY: totalH,
      primaryFootprint: clipped,
    };
  }

  return empty;
}

/**
 * Build an L-shape by subtracting a corner notch from the buildable polygon.
 * The notch is a rectangle aligned with the buildable's bounding box and
 * positioned at the chosen corner. Boolean difference (polygon-clipping)
 * keeps the result inside the buildable even on irregular plots.
 */
function lShapePolygon(buildable: Point[], ratio: number, position: CornerPosition): Point[] {
  const bb = polygonBBox(buildable);
  if (bb.w <= 0 || bb.h <= 0) return [];
  const Wx = bb.w * ratio;
  const Dy = bb.h * ratio;
  let nx0 = bb.minX;
  let ny0 = bb.minY;
  let nx1 = bb.minX + Wx;
  let ny1 = bb.minY + Dy;
  if (position === "NE") {
    nx0 = bb.maxX - Wx;
    nx1 = bb.maxX;
    ny0 = bb.maxY - Dy;
    ny1 = bb.maxY;
  } else if (position === "NW") {
    nx0 = bb.minX;
    nx1 = bb.minX + Wx;
    ny0 = bb.maxY - Dy;
    ny1 = bb.maxY;
  } else if (position === "SE") {
    nx0 = bb.maxX - Wx;
    nx1 = bb.maxX;
    ny0 = bb.minY;
    ny1 = bb.minY + Dy;
  } else if (position === "SW") {
    nx0 = bb.minX;
    nx1 = bb.minX + Wx;
    ny0 = bb.minY;
    ny1 = bb.minY + Dy;
  }
  const notch: Point[] = [
    { x: nx0, y: ny0 },
    { x: nx1, y: ny0 },
    { x: nx1, y: ny1 },
    { x: nx0, y: ny1 },
  ];
  return polygonDifference(buildable, notch);
}

/**
 * Build a U-shape by subtracting a central rectangular notch from one side
 * of the buildable polygon. Opening side determines which edge the U opens
 * onto. Uses polygon-clipping difference so the result is always inside the
 * buildable, regardless of plot shape.
 */
function uShapePolygon(buildable: Point[], arm: number, depth: number, opening: SidePosition): Point[] {
  const bb = polygonBBox(buildable);
  if (bb.w <= 0 || bb.h <= 0) return [];
  // Notch sits centered along the chosen side, leaving 'arm' fraction at each end.
  let nx0: number, nx1: number, ny0: number, ny1: number;
  if (opening === "N") {
    nx0 = bb.minX + bb.w * arm;
    nx1 = bb.maxX - bb.w * arm;
    ny0 = bb.maxY - bb.h * depth;
    ny1 = bb.maxY;
  } else if (opening === "S") {
    nx0 = bb.minX + bb.w * arm;
    nx1 = bb.maxX - bb.w * arm;
    ny0 = bb.minY;
    ny1 = bb.minY + bb.h * depth;
  } else if (opening === "E") {
    nx0 = bb.maxX - bb.w * depth;
    nx1 = bb.maxX;
    ny0 = bb.minY + bb.h * arm;
    ny1 = bb.maxY - bb.h * arm;
  } else {
    // W
    nx0 = bb.minX;
    nx1 = bb.minX + bb.w * depth;
    ny0 = bb.minY + bb.h * arm;
    ny1 = bb.maxY - bb.h * arm;
  }
  const notch: Point[] = [
    { x: nx0, y: ny0 },
    { x: nx1, y: ny0 },
    { x: nx1, y: ny1 },
    { x: nx0, y: ny1 },
  ];
  return polygonDifference(buildable, notch);
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

/**
 * Clip a candidate polygon (footprint) against the buildable polygon so the
 * volume never extends outside the green area. Uses the full polygon-clipping
 * Martinez–Rueda intersection so it is robust on concave buildables. Returns
 * [] if the clip is degenerate (very small or fully outside).
 */
function clipToBuildable(poly: Point[], buildable: Point[]): Point[] {
  if (poly.length < 3 || buildable.length < 3) return [];
  const clipped = polygonIntersection(poly, buildable);
  if (clipped.length < 3) return [];
  if (polygonArea(clipped) < 0.5) return [];
  return clipped;
}
