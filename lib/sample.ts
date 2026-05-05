import type { Project, Typology, ProgramCell, CommonArea } from "./types";

const t = (
  id: string,
  name: string,
  category: Typology["category"],
  internalArea: number,
  balconyArea: number,
  occupancy: number,
  parkingPerUnit: number
): Typology => ({ id, name, category, internalArea, balconyArea, occupancy, parkingPerUnit });

const STUDIO = t("studio-a", "Studio Type A", "Studio", 31, 8, 1.5, 1);
const BR1A = t("1br-a", "1BR Type A", "1BR", 64.81, 12, 2, 1);
const BR1B = t("1br-b", "1BR Type B", "1BR", 61.75, 12, 2, 1);
const BR1C = t("1br-c", "1BR Type C", "1BR", 64.07, 12, 2, 1);
const BR1D = t("1br-d", "1BR Type D", "1BR", 63.74, 12, 2, 1);
const BR2A = t("2br-a", "2BR Type A", "2BR", 89.61, 33, 3, 1);
const BR2B = t("2br-b", "2BR Type B", "2BR", 86.09, 33, 3, 1);
const BR2C = t("2br-c", "2BR Type C", "2BR", 85.31, 33, 3, 1);
const BR2D = t("2br-d", "2BR Type D", "2BR", 73.76, 33, 3, 1);
const BR3A = t("3br-a", "3BR Type A", "3BR", 133.4, 33, 5, 2);

const TYPOLOGIES = [STUDIO, BR1A, BR1B, BR1C, BR1D, BR2A, BR2B, BR2C, BR2D, BR3A];

function row(floor: number, counts: Record<string, number>): ProgramCell[] {
  return Object.entries(counts).map(([typologyId, count]) => ({ floor, typologyId, count }));
}

const PROGRAM: ProgramCell[] = [
  ...row(1, { "studio-a": 23, "1br-a": 1, "1br-b": 12, "1br-c": 2, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 0, "3br-a": 1 }),
  ...row(2, { "studio-a": 23, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(3, { "studio-a": 23, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(4, { "studio-a": 23, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(5, { "studio-a": 23, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(6, { "studio-a": 23, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(7, { "studio-a": 22, "1br-a": 0, "1br-b": 12, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
  ...row(8, { "studio-a": 15, "1br-a": 0, "1br-b": 7, "1br-c": 1, "1br-d": 1, "2br-a": 1, "2br-b": 2, "2br-c": 2, "2br-d": 2, "3br-a": 1 }),
];

const ca = (id: string, name: string, area: number, floors: number, countAsGFA: boolean, notes?: string): CommonArea => ({
  id, name, area, floors, countAsGFA, notes,
});

const COMMON_AREAS: CommonArea[] = [
  ca("lobby-a", "Lobby A", 137.3, 1, true, "Ground floor"),
  ca("lobby-b", "Lobby B", 134.15, 1, true, "Ground floor"),
  ca("cs-f1", "Corridor + Stairs (F1)", 324.64, 1, true, "Floor 1"),
  ca("cs-f2-7", "Corridor + Stairs (F2-F7)", 318.4, 6, true, "Floors 2 to 7"),
  ca("cs-f8", "Corridor (F8)", 216.28, 1, true, "Floor 8"),
  ca("lifts", "Lifts", 35.34, 8, true, "All floors"),
  ca("services", "Services", 15.4, 8, true, "All floors"),
  ca("mep", "MEP", 30.5, 8, true, "All floors"),
  ca("pool-pump", "Pool Pump", 30.88, 1, true, "Floor 7"),
  ca("sauna", "Sauna", 71.17, 1, true, "Floor 7"),
  ca("health-club", "Health Club", 119.19, 1, true, "Floor 8"),
  ca("gym-f8", "Gym (F8)", 238.5, 1, true, "Floor 8"),
  ca("outdoor-pool-f1", "Outdoor Area + Pool (F1)", 924.25, 1, false, "Floor 1 — Open air"),
  ca("pool-f8", "Pool (F8)", 320.16, 1, false, "Floor 8 — Open air"),
  ca("multipurpose", "Multipurpose", 120.55, 1, false, "Roof — Open air"),
  ca("aquagym", "Aquagym", 48.75, 1, false, "Roof — Open air"),
  ca("gym-roof", "Gym (Roof)", 111.96, 1, false, "Roof — Open air"),
  ca("yoga", "Yoga", 59.7, 1, false, "Roof — Open air"),
  ca("clubhouse", "Club House", 108.15, 1, false, "Roof — Open air"),
  ca("bbq", "BBQ", 82.01, 1, false, "Roof — Open air"),
  ca("family-sitting", "Family Sitting", 124.7, 1, false, "Roof — Open air"),
  ca("zen", "Zen Garden", 46.68, 1, false, "Roof — Open air"),
];

export const PRODUCTION_CITY_SAMPLE: Project = {
  name: "Production City — Sample",
  zone: "Production City (IMPZ)",
  use: "RESIDENTIAL",
  plotArea: 6764.31,
  numFloors: 8,
  floorHeight: 3.6,
  shaftPerUnit: 0.5,
  prmPercent: 0.02,
  typologies: TYPOLOGIES,
  program: PROGRAM,
  commonAreas: COMMON_AREAS,
  parking: [
    { id: "b1", name: "Basement 01", standard: 204, prm: 2 },
    { id: "gf", name: "Ground Floor (Gate Level)", standard: 156, prm: 7 },
  ],
  otherUses: [],
  lifts: {
    cabinKg: 1275,
    speed: 1.75,
    timePerStop: 8,
    handlingPctStandard: 0.05,
    handlingPctPremium: 0.07,
    unitsPerLiftRule: 75,
    dcdMinLifts: 3,
    dcdMinUnitsThreshold: 100,
  },
  notes: "",
};

export function emptyProject(name = "New Project"): Project {
  return {
    name,
    zone: "Other",
    use: "RESIDENTIAL",
    plotArea: 0,
    numFloors: 1,
    floorHeight: 3.6,
    shaftPerUnit: 0.5,
    prmPercent: 0.02,
    typologies: [],
    program: [],
    commonAreas: [],
    parking: [],
    otherUses: [],
    lifts: {
      cabinKg: 1275,
      speed: 1.75,
      timePerStop: 8,
      handlingPctStandard: 0.05,
      handlingPctPremium: 0.07,
      unitsPerLiftRule: 75,
      dcdMinLifts: 3,
      dcdMinUnitsThreshold: 100,
    },
    notes: "",
  };
}
