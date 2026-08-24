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
  /** When set (> 0), this EXACT space count is the requirement for the row —
   *  netArea × ratio is ignored. */
  exactSpaces?: number;
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
  /** Optional per-tier building footprints traced on the same drawing, in
   *  image-pixel coords — for plots where the tower/podium shape differs from
   *  a simple setback offset of the plot line. */
  tierTracesPx?: {
    /** Legacy single ground/podium traces — superseded by the plural keys. */
    ground?: { x: number; y: number }[];
    podium?: { x: number; y: number }[];
    /** One trace per ground block / podium block, in drawing order. */
    grounds?: { x: number; y: number }[][];
    podiums?: { x: number; y: number }[][];
    /** Legacy single tower trace — superseded by `towers`. */
    tower?: { x: number; y: number }[];
    /** One trace per tower, in drawing order (Tower 1, Tower 2…). */
    towers?: { x: number; y: number }[][];
  };
  /** Calibration: two points in pixel coords plus their real-world distance (m). */
  calibration?: {
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    metres: number;
  };
}

export interface Project {
  id: string;
  /** Set once the project has been pushed to Supabase. Same value as the cloud row's primary key. */
  cloudId?: string;
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
  /** True once the class-mix has been applied at least once (manually or
   *  auto-seeded on first project open). Stops the auto-seed effect from
   *  re-applying the class mix after the user has emptied the list. */
  typologiesSeeded?: boolean;
  /** Per-category typology mix override (0..100 percentages). When a category
   *  has a value here it replaces the class default in the Apartments auto-fill.
   *  Categories without a value fall back to the class library. */
  typologyMix?: Partial<Record<UnitCategory, number>>;
  /** Per-TYPOLOGY unit-mix override (% of total units, 0..100, keyed by
   *  typology id). Takes precedence over the category mechanism: a typology
   *  with a value here contributes exactly that share; typologies without one
   *  fall back to their category's share split among same-category siblings.
   *  This is what lets "Studio Premium" and "Studio Standard" carry different
   *  percentages. */
  typologyMixById?: Record<string, number>;
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
  /** Polygon vertices in plot-local metres. Used when plotMode === "polygon". */
  plotPolygon?: { x: number; y: number }[];
  /** Custom tier footprints in plot-local metres (same frame as plotPolygon),
   *  traced on the Plot drawing. When set for a tier, Massing uses it verbatim
   *  instead of deriving that tier's footprint from per-edge setbacks — for
   *  plots where the tower/podium shape differs from the plot outline. */
  /** Legacy SINGLE ground/podium footprints — superseded by the plural
   *  arrays below, which still treat these as element #1 when set. */
  groundPolygon?: { x: number; y: number }[];
  podiumPolygon?: { x: number; y: number }[];
  /** MULTIPLE ground-floor footprints (plot-local metres). Massing builds one
   *  ground volume per polygon — for schemes with detached ground blocks. */
  groundPolygons?: { x: number; y: number }[][];
  /** MULTIPLE podium footprints (plot-local metres), one volume each. */
  podiumPolygons?: { x: number; y: number }[][];
  /** Legacy single tower footprint — superseded by `towerPolygons`. Still
   *  honoured (treated as one tower) when `towerPolygons` is unset. */
  towerPolygon?: { x: number; y: number }[];
  /** MULTIPLE tower footprints in plot-local metres. Massing builds one tower
   *  volume per polygon (same floor count/height for all). */
  towerPolygons?: { x: number; y: number }[][];
  /** Uniform fallback setback (m) for the ground-floor footprint. Used when
   *  `groundSetbackPerEdge` is not set or has a different length than the plot
   *  polygon. Basements always use 0 (full plot polygon). */
  groundSetbackM?: number;
  /** Per-edge ground setback (m). Index i is the setback of the edge going
   *  from vertex i to vertex i+1 in the plot polygon. */
  groundSetbackPerEdge?: number[];
  /** Uniform fallback setback (m) for the podium floors. */
  podiumSetbackM?: number;
  /** Per-edge podium setback (m). */
  podiumSetbackPerEdge?: number[];
  /** Uniform fallback setback (m) for the tower (type) floors. */
  towerSetbackM?: number;
  /** Per-edge tower setback (m). */
  towerSetbackPerEdge?: number[];
  /** Translate the tower footprint by (towerOffsetXM, towerOffsetYM) metres
   *  after applying the setbacks. Lets the tower sit off-centre on the plot. */
  towerOffsetXM?: number;
  towerOffsetYM?: number;
  /** Target GFA (m²) used as the reference when commonAreasInputMode === "percentage". */
  targetGFA?: number;
  /** Manual floor-plate areas (m²), entered directly in Distribution instead
   *  of derived from the plot polygon + setbacks in Massing (which can carry
   *  tracing/calibration error). Ground and podium are informational — cross-
   *  check against the retail/commercial GFA in Setup's breakdown. Tower is
   *  load-bearing: the residential GFA divided by this figure is how many
   *  tower floors get computed. */
  groundFootprintM2?: number;
  podiumFootprintM2?: number;
  towerFootprintM2?: number;
  /** Optional hard cap on tower floor count (zoning / DCAA height limit given
   *  as a floor count rather than a FAR or metre height). When the GFA-driven
   *  floor count would exceed this, the tower is clamped to the cap and
   *  Distribution flags that the residential GFA doesn't fully fit. */
  maxTowerFloors?: number;
  /** Retail parking standard — m² of retail GFA per required parking space.
   *  Default 70 m² / space (QUBE Dubai convention: 1 plaza por cada 70 m²
   *  de retail). Editable in the Parking tab. */
  retailM2PerSpace?: number;
  /** Average built area consumed by one parking space (incl. aisles, ramps).
   *  Used to estimate the total parking surface needed. Default 25 m² / space. */
  m2PerParkingSpace?: number;
  /** Parking surface on the ground floor (m²), if any. Absolute value — not
   *  multiplied by Setup's ground.count (ground is normally a single level). */
  groundParkingM2?: number;
  /** Parking surface per podium floor (m²), if any. Multiplied by Setup →
   *  Floor breakdown's `podium.count` to get the total podium parking surface. */
  podiumParkingPerFloorM2?: number;
  /** Override for the basement footprint (m²) used per basement level, when
   *  it covers less than the full plot (e.g. setbacks, a shared party wall).
   *  When unset, falls back to Setup's plot area (the historical assumption
   *  that basements run the full plot footprint). */
  basementFootprintM2?: number;
  /** Override for the number of boarding floors used by the Dubai Building
   *  Code D.8.8 lift sizing (Figure D.14). When unset, derived from the
   *  Setup floor breakdown (basements + ground + podium). */
  dbcBoardingFloors?: number;
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
  /** Real-estate economic analysis configuration. */
  economic?: EconomicConfig;
  /** Parametric facade treatment for the Massing viewer. */
  facade?: FacadeConfig;
}

/** Parameters for the modelled residential facade in the Massing viewer. */
export interface FacadeConfig {
  /** "massing" = flat volumes (default); "residential" = modelled facade with slabs, glazing, mullions and balconies. */
  mode?: "massing" | "residential";
  /** Vertical mullion spacing along the facade (m). Default 3.2. */
  panelWidthM?: number;
  /** Balcony slab depth (m). 0 hides balconies. Default 1.8. */
  balconyDepthM?: number;
  /** A balcony is placed on every Nth facade bay (rhythm mode) or with 1/N probability (random mode). Default 2. */
  balconyEveryNBays?: number;
  /** Fraction (0–1) of facade cells filled with a solid precast panel instead of glazing. Default 0.25. */
  solidPanelRatio?: number;
  /** "rhythm" = balconies stack in regular columns; "random" = scattered per cell. Default "rhythm". */
  balconyLayout?: "rhythm" | "random";
  /** Seed for the deterministic random pattern (solids + random balconies). */
  patternSeed?: number;
  /** Treatment for the Ground + Podium tiers: "massing" = flat volumes (default); "fins" = a full-height vertical fin/louvre screen wrapping the perimeter, in front of the solid volume. */
  groundPodiumTreatment?: "massing" | "fins";
  /** Centre-to-centre spacing between fins (m). Default 1.0. */
  finSpacingM?: number;
  /** Fin blade width along the facade direction (m). Default 0.15. */
  finWidthM?: number;
  /** Fin projection depth outward from the facade (m). Default 0.35. */
  finDepthM?: number;
  /** Model a swimming pool on the podium roof deck, only if it fits. */
  podiumPool?: boolean;
  /** Model a lounge + BBQ terrace on the podium roof deck, only if it fits. */
  podiumLoungeBbq?: boolean;
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
  // apartments.pct is never read directly — the effective share is derived as
  // 100 − amenities − circulation (services is BUA-only and doesn't compete).
  // Kept in sync here (89) so any accidental direct read stays coherent.
  apartments: { pct: 89, countsAsGFA: true },
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
      { id: "ca-amen-gym",    name: "Gym",         pct: 35, countsAsGFA: true },
      { id: "ca-amen-sauna",  name: "Sauna",       pct: 10, countsAsGFA: true },
      { id: "ca-amen-social", name: "Social area", pct: 25, countsAsGFA: true },
      { id: "ca-amen-kids",   name: "Kids area",   pct: 15, countsAsGFA: true },
      { id: "ca-amen-cowork", name: "Coworking",   pct: 15, countsAsGFA: true },
    ],
    circulation: [
      { id: "ca-circ-lobby",  name: "Lobbies",     pct: 45, countsAsGFA: true },
      { id: "ca-circ-corr",   name: "Corridors",   pct: 55, countsAsGFA: true },
    ],
    services: [
      { id: "ca-serv-mep",    name: "MEP rooms",   pct: 30, countsAsGFA: true },
      { id: "ca-serv-shafts", name: "Shafts",      pct: 35, countsAsGFA: true },
      { id: "ca-serv-ducts",  name: "Ducts",       pct: 15, countsAsGFA: true },
      { id: "ca-serv-plant",  name: "Plant rooms", pct: 20, countsAsGFA: true },
    ],
  };
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
  marketingPct?: number;          // default 0.01
  /** Permits & DM fees — fraction of construction. */
  permitsPct?: number;            // default 0.02
  /** Contingency — fraction of (construction + soft costs). */
  contingencyPct?: number;        // default 0.05
  /** Financing / interest during construction — fraction of construction. */
  financingPct?: number;          // default 0.06
  /** Brokerage / agent / sales — fraction of revenue. */
  brokeragePct?: number;          // default 0.07
  /** Optional branding fee (e.g. hotel-branded residence) — fraction of revenue. */
  brandingFeePct?: number;        // default 0
  /** UAE corporate tax rate — applied to gross profit above the exemption. */
  corporateTaxPct?: number;       // default 0.09
  /** UAE corporate tax exemption (AED) — first slice of profit not taxed. */
  corporateTaxExemption?: number; // default 0
}
