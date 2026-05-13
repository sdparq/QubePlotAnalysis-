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
  /** Stratified floor breakdown — basements, ground, podium and type (residential)
   *  floors. When set, `numFloors` and `floorHeight` are kept in sync with
   *  `typeFloors.count` and `typeFloors.heightM` so the rest of the app keeps
   *  working unchanged. The other sections only affect the Setup view and the
   *  building total-height display for now. */
  basements?: FloorSection;
  ground?: FloorSection;
  podium?: FloorSection;
  typeFloors?: FloorSection;
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
  /** Maximum total built area (BUA, m²) the project must respect — sometimes
   *  given as a plot-level constraint. When exceeded, the UI flags it. */
  maxBUA?: number;
  /** Optional split of the Target GFA across uses. Each entry can be entered
   *  either as an absolute m² value or as a percentage of `targetGFA`. */
  gfaBreakdown?: GfaBreakdown;
  /** Optional sub-breakdown of the Residential use (apartments / amenities /
   *  circulation / services), each with its own percentage and a GFA flag. */
  residentialBreakdown?: ResidentialBreakdown;
  /** Hierarchical breakdown of common areas with editable sub-percentages and
   *  GFA flags. When set it drives the flat `commonAreas` list automatically. */
  commonAreasBreakdown?: CommonAreasBreakdown;
  /** How the user enters common area sizes. "absolute" = m² × floors (default); "percentage" = each row stores a fraction of targetGFA and the m² is derived. */
  commonAreasInputMode?: "absolute" | "percentage";
  /** Per-project overrides for the waste-room calculation. Falls back to Dubai DM defaults. */
  garbage?: GarbageOverrides;
  /** Real-estate economic analysis configuration. */
  economic?: EconomicConfig;
  /** Geographic location of the plot, used for the Photorealistic 3D Tiles in-context view. */
  latitude?: number;
  longitude?: number;
  /** Heading of the plot's local +y axis relative to true north, in degrees clockwise. 0 = +y points north. */
  northHeadingDeg?: number;
  /** Optional manual ground-elevation override (m above WGS84 ellipsoid). When unset, the in-context viewer auto-fetches elevation from Open-Meteo. */
  groundElevationM?: number;
  /** Per-OSM-way height overrides (m) for surrounding buildings in the In-context view */
  nearbyHeightOverrides?: Record<string, number>;
  /** OSM way ids of surrounding buildings the user wants hidden from the In-context view */
  nearbyHidden?: string[];
  /** Tile basemap style for the In-context view */
  contextMapStyle?: "topo" | "satellite" | "schematic";
  /** Manual building XZ offset in metres (east/north) for fine alignment with the basemap. */
  contextOffsetXM?: number;
  contextOffsetZM?: number;
  /** Manually defined neighbouring buildings (for plots not yet in OSM) */
  customNeighbors?: CustomNeighbor[];
}

/** A user-drawn neighbouring building rendered as one box (podium) plus an optional tower on top. */
export interface CustomNeighbor {
  id: string;
  name?: string;
  /** World XZ position of the podium centre, in metres. */
  centerX: number;
  centerZ: number;
  /** Rotation of the building around +Y axis, degrees. 0 = aligned with world axes. */
  rotationDeg: number;
  /** Podium / base box dimensions (m). */
  widthM: number;
  depthM: number;
  heightM: number;
  /** Optional tower box stacked on top of the podium. */
  tower?: {
    widthM: number;
    depthM: number;
    heightM: number;
    /** Tower offset from podium centre, in the building's own rotated frame (m). */
    offsetXM?: number;
    offsetZM?: number;
  };
}

export interface FloorSection {
  count: number;
  heightM: number;
}

export type GfaUseCategory = "residential" | "retail" | "commercial" | "hospitality";

export interface GfaBreakdownItem {
  /** "absolute" = `value` is in m². "percent" = `value` is in 0–100. */
  mode: "absolute" | "percent";
  value: number;
}

export type GfaBreakdown = Partial<Record<GfaUseCategory, GfaBreakdownItem>>;

export type ResidentialSubCategory = "apartments" | "amenities" | "circulation" | "services";

export interface ResidentialSubItem {
  /** Percentage of the project's Residential GFA, 0..100. */
  pct: number;
  /** Whether this sub-category counts towards the project's reported GFA.
   *  Some zones exclude services (MEP, shafts) and balconies from GFA. */
  countsAsGFA: boolean;
}

export type ResidentialBreakdown = Record<ResidentialSubCategory, ResidentialSubItem>;

export const DEFAULT_RESIDENTIAL_BREAKDOWN: ResidentialBreakdown = {
  apartments: { pct: 79, countsAsGFA: true },
  amenities:  { pct:  1, countsAsGFA: true },
  circulation:{ pct: 10, countsAsGFA: true },
  services:   { pct: 10, countsAsGFA: true },
};

export type CommonAreasGroup = "amenities" | "circulation" | "services";

export interface CommonAreaSub {
  id: string;
  name: string;
  /** Percentage of the parent group's BUA (0..100). */
  pct: number;
  countsAsGFA: boolean;
}

export interface CommonAreasBreakdown {
  amenities: CommonAreaSub[];
  circulation: CommonAreaSub[];
  services: CommonAreaSub[];
}

export function defaultCommonAreasBreakdown(): CommonAreasBreakdown {
  return {
    amenities: [
      { id: "ca-amen-gym",    name: "Gym",         pct: 25, countsAsGFA: true  },
      { id: "ca-amen-pool",   name: "Pool",        pct: 20, countsAsGFA: false },
      { id: "ca-amen-sauna",  name: "Sauna",       pct: 5,  countsAsGFA: true  },
      { id: "ca-amen-padel",  name: "Padel court", pct: 15, countsAsGFA: false },
      { id: "ca-amen-social", name: "Social area", pct: 15, countsAsGFA: true  },
      { id: "ca-amen-kids",   name: "Kids area",   pct: 10, countsAsGFA: true  },
      { id: "ca-amen-cowork", name: "Coworking",   pct: 10, countsAsGFA: true  },
    ],
    circulation: [
      { id: "ca-circ-lobby",  name: "Lobbies",     pct: 30, countsAsGFA: true },
      { id: "ca-circ-corr",   name: "Corridors",   pct: 35, countsAsGFA: true },
      { id: "ca-circ-lift",   name: "Lift cores",  pct: 20, countsAsGFA: true },
      { id: "ca-circ-stairs", name: "Stairs",      pct: 15, countsAsGFA: true },
    ],
    services: [
      { id: "ca-serv-mep",    name: "MEP rooms",   pct: 30, countsAsGFA: true },
      { id: "ca-serv-shafts", name: "Shafts",      pct: 35, countsAsGFA: true },
      { id: "ca-serv-ducts",  name: "Ducts",       pct: 15, countsAsGFA: true },
      { id: "ca-serv-plant",  name: "Plant rooms", pct: 20, countsAsGFA: true },
    ],
  };
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

export interface EconomicConfig {
  currency?: string;                          // default "AED"
  /** AED per m² of sellable area, keyed by typology id. */
  typologyPricing?: { [typologyId: string]: number };
  /** Parking sold separately. */
  parkingSpacesForSale?: number;
  parkingPricePerSpace?: number;
  /** Optional retail / F&B revenue. */
  retailRevenue?: number;

  /** Land acquisition cost (total). */
  landCost?: number;
  /** Construction rate per m² of BUA. */
  constructionRatePerBUA?: number;

  /** Soft costs (consultants, design fees) — fraction of construction. */
  softCostsPct?: number;          // default 0.06
  /** Marketing & sales — fraction of revenue. */
  marketingPct?: number;          // default 0.04
  /** Permits & DM fees — fraction of construction. */
  permitsPct?: number;            // default 0.02
  /** Contingency — fraction of (construction + soft costs). */
  contingencyPct?: number;        // default 0.05
  /** Financing / interest during construction — fraction of construction. */
  financingPct?: number;          // default 0.03
  /** Brokerage / agent fees — fraction of revenue. */
  brokeragePct?: number;          // default 0.02
  /** Optional branding fee (e.g. hotel-branded residence) — fraction of revenue. */
  brandingFeePct?: number;        // default 0
}
