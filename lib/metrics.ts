import type { Project } from "./types";
import { computeAreas } from "./calc/areas";
import { computeProgram } from "./calc/program";
import { computeParking } from "./calc/parking";

export const M2_TO_SQFT = 10.7639;

/**
 * Headline figures of a scheme — the numbers a developer asks for first.
 * Everything is derived from the same calculation modules the tabs use, so
 * the KPI bar, the sidebar statuses and the 3D presentation overlay always
 * agree with the Areas Summary.
 */
export interface ProjectMetrics {
  plotArea: number;
  targetGFA: number;
  totalGFA: number;
  /** totalGFA / targetGFA, null without a target. */
  gfaOfTarget: number | null;
  /** totalGFA / plot area, null without either. */
  far: number | null;
  units: number;
  /** Sellable area per unit (interior + balcony), null without units. */
  avgUnitM2: number | null;
  /** Sellable area (GSA) — residential + retail. */
  gsa: number;
  /** Construction built-up area. */
  bua: number;
  /** GSA / BUA — sellable share of everything built (the headline
   *  construction efficiency), null without a BUA. GSA / GFA is not used as
   *  the headline: balconies are sellable but usually excluded from GFA, so
   *  it can exceed 100 %. */
  efficiency: number | null;
  basements: number;
  ground: number;
  podium: number;
  tower: number;
  floorsAboveGround: number;
  /** Height above ground to the top of the last type floor (m). */
  heightM: number;
  /** Dubai storey notation, e.g. "2B+G+3P+24". */
  heightCode: string;
  /** Spaces required (standard + POD), as in the Parking step. */
  parkingRequired: number;
  /** Spaces the planned parking surface holds: (basements × footprint +
   *  ground + podium parking m²) ÷ m² per space — the Parking step's model. */
  parkingProvided: number;
  /** Planned parking surface minus the surface the required spaces need (m²). */
  parkingSurfaceBalance: number;
}

/** Dubai storey notation: basements, ground, podium levels and type floors. */
export function heightCode(basements: number, ground: number, podium: number, tower: number): string {
  const parts: string[] = [];
  if (basements > 0) parts.push(`${basements}B`);
  parts.push(ground > 1 ? `${ground}G` : "G");
  if (podium > 0) parts.push(`${podium}P`);
  if (tower > 0) parts.push(`${tower}`);
  return parts.join("+");
}

export function projectMetrics(project: Project): ProjectMetrics {
  const areas = computeAreas(project);
  const program = computeProgram(project);
  const parking = computeParking(project);

  const basements = Math.max(0, project.basements?.count ?? 0);
  const ground = Math.max(0, project.ground?.count ?? 1);
  const podium = Math.max(0, project.podium?.count ?? 0);
  const tower = Math.max(0, project.typeFloors?.count ?? project.numFloors);
  const heightM =
    ground * (project.ground?.heightM ?? 4.5) +
    podium * (project.podium?.heightM ?? 4.0) +
    tower * (project.typeFloors?.heightM ?? project.floorHeight);

  const plotArea = project.plotArea > 0 ? project.plotArea : 0;
  const totalGFA = areas.totalGFA;

  const basementFootprint = project.basementFootprintM2 ?? plotArea;
  const parkingSurface =
    Math.max(0, basementFootprint) * basements +
    Math.max(0, project.groundParkingM2 ?? 0) +
    Math.max(0, project.podiumParkingPerFloorM2 ?? 0) * podium;
  const m2PerSpace = parking.m2PerParkingSpaceUsed > 0 ? parking.m2PerParkingSpaceUsed : 25;
  const units = program.totalUnits;

  return {
    plotArea,
    targetGFA: areas.targetGFA,
    totalGFA,
    gfaOfTarget: areas.targetGFA > 0 ? totalGFA / areas.targetGFA : null,
    far: plotArea > 0 && totalGFA > 0 ? totalGFA / plotArea : null,
    units,
    avgUnitM2: units > 0 ? program.totalSellable / units : null,
    gsa: areas.gsaTotal,
    bua: areas.constructionBUA,
    efficiency: areas.constructionBUA > 0 && areas.gsaTotal > 0 ? areas.gsaTotal / areas.constructionBUA : null,
    basements,
    ground,
    podium,
    tower,
    floorsAboveGround: ground + podium + tower,
    heightM,
    heightCode: heightCode(basements, ground, podium, tower),
    parkingRequired: Math.ceil(parking.grandRequiredWithPOD),
    parkingProvided: Math.floor(parkingSurface / m2PerSpace + 1e-9),
    parkingSurfaceBalance: parkingSurface - parking.totalParkingSurfaceM2,
  };
}

/** Compact thousands formatting for headline figures: 1,284 · 12.9K · 4.2M. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 100_000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toLocaleString("en-US");
}
