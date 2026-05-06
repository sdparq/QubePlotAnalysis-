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

export interface CommonArea {
  id: string;
  name: string;
  area: number;
  floors: number;
  countAsGFA: boolean;
  notes?: string;
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
}
