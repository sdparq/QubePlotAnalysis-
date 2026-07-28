import type { GfaUseCategory, Project } from "../types";
import { residentialGFATarget, residentialSubPct, residentialSubQuota } from "./gfa";
import { computeProgram } from "./program";
import { computeParking } from "./parking";

/**
 * Project-wide area accounting — the single source of truth behind the Areas
 * Summary tab and the PDF report.
 *
 * GSA (sellable) = apartments interior + balconies + retail.
 *
 * BUA (construction) = what actually gets built:
 *     residential sellable (apartments interior + balconies)
 *   + retail GFA  + commercial GFA
 *   + amenities + circulation + services
 *   + the parking surface placed in the GROUND floor and PODIUM
 *   + the basements, MINUS any surplus parking surface
 *
 * The basement deduction matters: basements are sized as levels × footprint,
 * so a project that over-provides parking would otherwise book built area it
 * doesn't need. Whatever the planned parking surface exceeds the requirement
 * is trimmed off the basements (floored at zero).
 *
 * Note what is NOT here: the ground/podium SHELL is not counted as a slab —
 * its programme is already represented by retail, commercial, amenities and
 * the parking placed there. Counting the plates as well would double-book it.
 */
export interface AreasResult {
  targetGFA: number;
  /** Residential GFA (hospitality already rolled in — see residentialGFATarget). */
  residentialGFA: number;
  hospitalityGFA: number;
  retailGFA: number;
  commercialGFA: number;
  totalGFA: number;

  apartmentsPct: number;
  apartmentsInterior: number;
  balconyShare: number;
  balconies: number;
  amenities: number;
  circulation: number;
  services: number;

  /** Parking surface planned in the ground floor + podium levels. */
  groundPodiumParking: number;
  /** Basement levels × footprint, before the surplus deduction. */
  basementSurface: number;
  /** Planned parking surface beyond what the requirement needs. */
  parkingSurplus: number;
  /** Basement surface actually booked as BUA (surface − surplus, ≥ 0). */
  basementsNet: number;
  parkingRequiredSurface: number;

  /** Residential sellable only (apartments interior + balconies). */
  gsaResidential: number;
  /** Sellable total — residential + retail. */
  gsaTotal: number;
  constructionBUA: number;
}

function useGFA(project: Project, key: GfaUseCategory): number {
  const item = project.gfaBreakdown?.[key];
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

export function computeAreas(project: Project): AreasResult {
  const targetGFA = project.targetGFA ?? 0;
  const residentialGFA = residentialGFATarget(project);
  const hospitality = useGFA(project, "hospitality");
  const retailGFA = useGFA(project, "retail");
  const commercialGFA = useGFA(project, "commercial");
  const totalGFA = residentialGFA + retailGFA + commercialGFA;

  // Residential quotas — percentages of the residential GFA (Distribution).
  const apartmentsPct = residentialSubPct(project, "apartments");
  const apartmentsInterior = residentialSubQuota(project, "apartments");
  const amenities = residentialSubQuota(project, "amenities");
  const circulation = residentialSubQuota(project, "circulation");
  const services = residentialSubQuota(project, "services");

  // Balconies ride on the apartments quota at the share measured in the
  // Apartments matrix (Σ balconies ÷ Σ interiors of the placed units).
  const program = computeProgram(project);
  const balconyShare =
    program.totalInteriorGFA > 0 ? program.totalBalcony / program.totalInteriorGFA : 0;
  const balconies = apartmentsInterior * balconyShare;

  // Parking surfaces — same model as the Parking tab.
  const parking = computeParking(project);
  const parkingRequiredSurface = parking.totalParkingSurfaceM2;
  const podiumCount = project.podium?.count ?? 0;
  const groundPodiumParking =
    Math.max(0, project.groundParkingM2 ?? 0) +
    Math.max(0, project.podiumParkingPerFloorM2 ?? 0) * podiumCount;
  const basementCount = project.basements?.count ?? 0;
  const basementFootprint = project.basementFootprintM2 ?? project.plotArea ?? 0;
  const basementSurface = Math.max(0, basementCount * basementFootprint);
  const parkingSurplus = Math.max(
    0,
    groundPodiumParking + basementSurface - parkingRequiredSurface,
  );
  const basementsNet = Math.max(0, basementSurface - parkingSurplus);

  const gsaResidential = apartmentsInterior + balconies;
  const gsaTotal = gsaResidential + retailGFA;

  const constructionBUA =
    gsaResidential +
    retailGFA +
    commercialGFA +
    amenities +
    circulation +
    services +
    groundPodiumParking +
    basementsNet;

  return {
    targetGFA,
    residentialGFA,
    hospitalityGFA: hospitality,
    retailGFA,
    commercialGFA,
    totalGFA,
    apartmentsPct,
    apartmentsInterior,
    balconyShare,
    balconies,
    amenities,
    circulation,
    services,
    groundPodiumParking,
    basementSurface,
    parkingSurplus,
    basementsNet,
    parkingRequiredSurface,
    gsaResidential,
    gsaTotal,
    constructionBUA,
  };
}
