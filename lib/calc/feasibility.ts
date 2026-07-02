import type { Point } from "../geom";
import { offsetPolygon, polygonArea, rectanglePlotPolygon } from "../geom";
import type { Project } from "../types";
import { residentialSubPct, residentialGFATarget } from "./gfa";
import { computeProgramAutoFill, resolveTypologyMix } from "./program-autofill";
import { computeParking } from "./parking";
import { DEFAULT_ZONE_CLASSES, classForZone, type ZoneClass } from "../zone-classes";

/** One derived fact with a plain-language explanation of where it comes from. */
export interface FeasibilityFact {
  value: number;
  basis: string;
}

export interface FeasibilityResult {
  /** Inputs resolved */
  plotArea: number;
  maxFAR: number | null;
  detectedClass: ZoneClass | null;

  /** GFA budget */
  maxGFA: FeasibilityFact | null;         // plotArea × maxFAR (null when no FAR)
  targetGFA: number;                       // what the user set in Setup
  gfaGapVsMax: number | null;              // maxGFA − targetGFA

  /** Footprints (m²) */
  groundFootprint: number;
  podiumFootprint: number;
  towerFootprint: number;

  /** Floors */
  groundFloors: number;
  podiumFloors: number;
  currentTowerFloors: number;
  /** How many tower floors the GFA budget allows on the current footprint. */
  maxTowerFloors: FeasibilityFact | null;
  totalHeightM: number;
  maxHeightM: FeasibilityFact | null;

  /** Residential yield */
  apartmentsGFA: number;
  apartmentsPct: number;
  estimatedUnits: FeasibilityFact | null;
  unitsByCategory: { category: string; units: number }[];

  /** Parking */
  parkingRequired: number;
  parkingAvailable: number;
  parkingBalanceSpaces: number;

  /** Readiness — which inputs are still missing for a full answer. */
  missing: string[];
}

function uniformEdges(poly: Point[], uniform: number, perEdge: number[] | undefined): number[] {
  if (perEdge && perEdge.length === poly.length) return perEdge.map((v) => Math.max(0, v));
  return poly.map(() => Math.max(0, uniform));
}

function tierArea(poly: Point[], edges: number[]): number {
  if (poly.length < 3) return 0;
  if (edges.every((s) => s <= 0)) return polygonArea(poly);
  return polygonArea(offsetPolygon(poly, edges));
}

/** Answer "what can I build on this plot?" from the data already captured in
 *  Setup / Massing / Typologies. Everything is derived — nothing is written. */
export function computeFeasibility(project: Project): FeasibilityResult {
  const missing: string[] = [];

  const plotArea = project.plotArea ?? 0;
  if (plotArea <= 0) missing.push("Plot area (Setup)");

  const maxFAR = project.maxFAR && project.maxFAR > 0 ? project.maxFAR : null;
  if (!maxFAR) missing.push("Max FAR (Setup) — needed to compute the GFA ceiling");

  const detectedClass = classForZone(project.zone, DEFAULT_ZONE_CLASSES);

  // ---- geometry ----
  const sqRoot = plotArea > 0 ? Math.sqrt(plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;
  const plotPoly: Point[] =
    project.plotMode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3
      ? project.plotPolygon
      : rectanglePlotPolygon(frontage, depth);

  const groundFootprint = tierArea(plotPoly, uniformEdges(plotPoly, project.groundSetbackM ?? 3, project.groundSetbackPerEdge));
  const podiumFootprint = tierArea(plotPoly, uniformEdges(plotPoly, project.podiumSetbackM ?? 3, project.podiumSetbackPerEdge));
  const towerFootprint = tierArea(plotPoly, uniformEdges(plotPoly, project.towerSetbackM ?? 6, project.towerSetbackPerEdge));

  // ---- floors ----
  const groundFloors = project.ground?.count ?? 1;
  const groundHeightM = project.ground?.heightM ?? 4.5;
  const podiumFloors = project.podium?.count ?? 0;
  const podiumHeightM = project.podium?.heightM ?? 4.0;
  const currentTowerFloors = project.typeFloors?.count ?? project.numFloors;
  const towerHeightM = project.typeFloors?.heightM ?? project.floorHeight;

  const maxGFA: FeasibilityFact | null = maxFAR && plotArea > 0
    ? {
        value: plotArea * maxFAR,
        basis: `${Math.round(plotArea).toLocaleString("en-US")} m² plot × FAR ${maxFAR}`,
      }
    : null;

  const targetGFA = project.targetGFA ?? 0;
  const gfaGapVsMax = maxGFA ? maxGFA.value - targetGFA : null;

  // Max tower floors = (GFA budget − ground − podium GFA) / tower footprint.
  let maxTowerFloors: FeasibilityFact | null = null;
  let maxHeightM: FeasibilityFact | null = null;
  if (maxGFA && towerFootprint > 0) {
    const baseGFA = groundFootprint * groundFloors + podiumFootprint * podiumFloors;
    const remaining = Math.max(0, maxGFA.value - baseGFA);
    const floors = Math.floor(remaining / towerFootprint);
    maxTowerFloors = {
      value: floors,
      basis: `(${Math.round(maxGFA.value).toLocaleString("en-US")} − ${Math.round(baseGFA).toLocaleString("en-US")} base) ÷ ${Math.round(towerFootprint).toLocaleString("en-US")} m² tower footprint`,
    };
    maxHeightM = {
      value: groundFloors * groundHeightM + podiumFloors * podiumHeightM + floors * towerHeightM,
      basis: `ground + podium + ${floors} tower floors × ${towerHeightM} m`,
    };
  }

  const totalHeightM =
    groundFloors * groundHeightM + podiumFloors * podiumHeightM + currentTowerFloors * towerHeightM;

  // ---- residential yield ----
  const residentialGFA = residentialGFATarget(project);
  if (residentialGFA <= 0) missing.push("Residential GFA (Setup → GFA breakdown)");
  const apartmentsPct = residentialSubPct(project, "apartments");
  const apartmentsGFA = (apartmentsPct / 100) * residentialGFA;

  let estimatedUnits: FeasibilityFact | null = null;
  let unitsByCategory: { category: string; units: number }[] = [];
  if (project.typologies.length === 0) {
    missing.push("Typologies (tab 03) — needed to estimate unit counts");
  } else if (apartmentsGFA > 0) {
    const classMix = detectedClass ? DEFAULT_ZONE_CLASSES[detectedClass].typologyMix : null;
    if (classMix) {
      const fill = computeProgramAutoFill(project, resolveTypologyMix(project, classMix));
      if (fill && fill.totalUnits > 0) {
        estimatedUnits = {
          value: fill.totalUnits,
          basis: `${Math.round(apartmentsGFA).toLocaleString("en-US")} m² apartments GFA ÷ mix-weighted unit size`,
        };
        const byCat = new Map<string, number>();
        for (const t of fill.perTypology) {
          if (t.units > 0) byCat.set(t.typology.category, (byCat.get(t.typology.category) ?? 0) + t.units);
        }
        unitsByCategory = Array.from(byCat.entries()).map(([category, units]) => ({ category, units }));
      }
    }
  }

  // ---- parking ----
  const parking = computeParking(project);
  const otherFloors = project.otherParkingFloorsCount ?? project.podium?.count ?? 0;
  const otherPerFloor = project.otherParkingPerFloorM2 ?? project.podiumParkingPerFloorM2 ?? podiumFootprint;
  const basementCount = project.basements?.count ?? 0;
  const m2PerSpace = project.m2PerParkingSpace ?? 25;
  const availableSurface = plotArea * basementCount + otherPerFloor * otherFloors;
  const parkingAvailable = m2PerSpace > 0 ? Math.floor(availableSurface / m2PerSpace) : 0;
  const parkingRequired = Math.ceil(parking.grandRequired + parking.requiredPRM);

  return {
    plotArea,
    maxFAR,
    detectedClass,
    maxGFA,
    targetGFA,
    gfaGapVsMax,
    groundFootprint,
    podiumFootprint,
    towerFootprint,
    groundFloors,
    podiumFloors,
    currentTowerFloors,
    maxTowerFloors,
    totalHeightM,
    maxHeightM,
    apartmentsGFA,
    apartmentsPct,
    estimatedUnits,
    unitsByCategory,
    parkingRequired,
    parkingAvailable,
    parkingBalanceSpaces: parkingAvailable - parkingRequired,
    missing,
  };
}
