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
}
