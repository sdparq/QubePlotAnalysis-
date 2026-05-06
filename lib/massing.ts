import {
  type Point,
  polygonArea,
  polygonBBox,
  scalePolygon,
  scalePolygonToArea,
  translatePolygon,
} from "./geom";

export type MassingShape = "block" | "podiumTower" | "courtyard" | "twinTowers";
export type TowerPosition = "C" | "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

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

  return empty;
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
