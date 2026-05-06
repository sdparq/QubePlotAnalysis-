export type UnitCategory = "Studio" | "1BR" | "2BR" | "3BR" | "4BR" | "Penthouse";

export interface Typology {
  id: string;
  name: string;
  category: UnitCategory;
  internalArea: number;
  balconyArea: number;
  occupancy: number;
  parkingPerUnit: number;
}

export interface ProgramCell {
  floor: number;
  typologyId: string;
  count: number;
}

export type CommonAreaCategory = "GFA" | "BUA" | "OPEN";

export interface CommonArea {
  id: string;
  name: string;
  area: number;
  floors: number;
  /**
   * "GFA" — counts toward both GFA and BUA (lobbies, indoor amenities counted for FAR)
   * "BUA" — counts toward BUA only (shafts, lift cores, stairs, MEP rooms, basement parking)
   * "OPEN" — counts toward neither (open-air rooftop amenities)
   */
  category?: CommonAreaCategory;
  /** @deprecated kept for backwards compatibility — replaced by `category`. */
  countAsGFA?: boolean;
  notes?: string;
}

export function commonAreaCategory(c: CommonArea): CommonAreaCategory {
  if (c.category) return c.category;
  if (c.countAsGFA === true) return "GFA";
  if (c.countAsGFA === false) return "OPEN";
  return "GFA";
}

/** Resolve the effective total m² of a common area, taking into account the project's input mode. */
export function effectiveCommonAreaTotal(
  c: CommonArea,
  project: { commonAreasInputMode?: "absolute" | "percentage"; targetGFA?: number }
): number {
  if (project.commonAreasInputMode === "percentage") {
    const target = project.targetGFA ?? 0;
    return (c.area || 0) * target;
  }
  return (c.area || 0) * (c.floors || 1);
}

export interface ParkingLevel {
  id: string;
  name: string;
  standard: number;
  prm: number;
  notes?: string;
}

export interface OtherUse {
  id: string;
  name: string;
  netArea: number;
  spacesPer100sqm: number;
}

export interface LiftsConfig {
  cabinKg: 1000 | 1275 | 1600;
  speed: number;
  timePerStop: number;
  handlingPctStandard: number;
  handlingPctPremium: number;
  unitsPerLiftRule: number;
  dcdMinLifts: number;
  dcdMinUnitsThreshold: number;
}

export interface ParcelInfo {
  fileName: string;
  fileType: string;
  imageDataUrl: string;
  uploadedAt: number;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  /** Plot polygon vertices traced on top of the drawing, in image-pixel coords. */
  tracePolygonPx?: { x: number; y: number }[];
  /** Calibration: two points in pixel coords plus their real-world distance (m). */
  calibration?: {
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    metres: number;
  };
}

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  zone: string;
  use: "RESIDENTIAL";
  plotArea: number;
  numFloors: number;
  floorHeight: number;
  shaftPerUnit: number;
  prmPercent: number;
  typologies: Typology[];
  program: ProgramCell[];
  commonAreas: CommonArea[];
  parking: ParkingLevel[];
  otherUses: OtherUse[];
  lifts: LiftsConfig;
  notes: string;
  parcel?: ParcelInfo;
  /** Optional plot geometry for 3D massing. If unset, falls back to a square derived from plotArea. */
  plotMode?: "rectangular" | "polygon";
  plotFrontage?: number;
  plotDepth?: number;
  setbackFront?: number;
  setbackRear?: number;
  setbackSide?: number;
  /** Polygon vertices in plot-local metres. Used when plotMode === "polygon". */
  plotPolygon?: { x: number; y: number }[];
  /** Uniform setback applied to every polygon edge (m). Used as default if setbackPerEdge is not set. */
  setbackUniform?: number;
  /** Per-edge setback in metres. Length must match plotPolygon.length. Index i = setback of edge from vertex i to vertex i+1. */
  setbackPerEdge?: number[];
  /** Override for the 3D massing only — number of floors to extrude. Falls back to numFloors if undefined. */
  massingFloors?: number;
  /** Override for the 3D massing only — building footprint area per floor (m²). Falls back to GFA/floors. */
  massingFloorArea?: number;
  /** Building shape preset for the 3D massing. Defaults to "block". */
  massingShape?: "block" | "podiumTower" | "courtyard" | "twinTowers" | "stepped" | "lShape" | "uShape";
  /** Podium-and-tower preset parameters. */
  podiumFloors?: number;
  podiumCoverage?: number;          // 0..1 fraction of buildable area
  towerCoverage?: number;           // 0..1 fraction of buildable area
  towerPosition?: "C" | "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
  /** Courtyard preset — fraction of the building footprint that is the central patio. */
  courtyardRatio?: number;          // 0..0.6
  /** Twin-towers preset. */
  twinSeparation?: number;          // metres between tower centroids
  twinCoverage?: number;            // 0..1 fraction of buildable area, per tower
  /** Stepped / terraced preset. */
  steppedSteps?: number;            // 2..6 — number of stepped levels
  steppedShrink?: number;           // 0..0.5 — fraction the footprint shrinks per step
  /** L-shape preset. */
  lNotchPosition?: "NE" | "NW" | "SE" | "SW";
  lNotchRatio?: number;             // 0..0.6 — fraction of the bbox cut from the chosen corner
  /** U-shape preset. */
  uOpening?: "N" | "S" | "E" | "W";
  uArmRatio?: number;               // 0..0.5 — thickness of each arm relative to bbox
  uNotchDepth?: number;             // 0..0.9 — depth of the central notch as fraction of bbox
  /** Hard constraints used to score variants and flag the active massing. */
  maxFAR?: number;
  maxHeightM?: number;
  /** Target GFA (m²) used as the reference when commonAreasInputMode === "percentage". */
  targetGFA?: number;
  /** How the user enters common area sizes. "absolute" = m² × floors (default); "percentage" = each row stores a fraction of targetGFA and the m² is derived. */
  commonAreasInputMode?: "absolute" | "percentage";
  /** Per-project overrides for the waste-room calculation. Falls back to Dubai DM defaults. */
  garbage?: GarbageOverrides;
}

export interface GarbageOverrides {
  generationKgPer100sqmPerDay?: number;  // default 12 (Dubai DM)
  storageDays?: number;                   // default 2
  densityKgPerM3?: number;                // default 150
  containerCapacityM3?: number;           // default 2.5
  containerWidthM?: number;               // default 1.37
  containerLengthM?: number;              // default 2.04
  separationM?: number;                   // default 0.15
  frontClearanceM?: number;               // default 0.6
}
