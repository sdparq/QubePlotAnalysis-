import type { CommonArea, Project } from "../types";
import { DEFAULT_RESIDENTIAL_BREAKDOWN, commonAreaCategory } from "../types";

/** Residential GFA target — inlined here (rather than importing gfa.ts) to
 *  avoid an import cycle: gfa.ts imports program.ts, program.ts imports us. */
function residentialGFAOf(project: Project): number {
  const item = project.gfaBreakdown?.residential;
  if (!item) return 0;
  const target = project.targetGFA ?? 0;
  return item.mode === "absolute" ? item.value : (item.value / 100) * target;
}

export interface DerivedCommonAreas {
  /** Totals consumed by computeProgram. */
  commonAreasGFA: number;
  commonAreasBUAonly: number;
  commonAreasOpen: number;
  /** Efficiency reporting split. `servicesArea` is BUA in the new model
   *  (services doesn't count toward GFA) and GFA in the legacy model. */
  amenitiesGFA: number;
  circulationGFA: number;
  servicesArea: number;
  /** Flat rows in the shape the export expects. */
  flat: CommonArea[];
}

/** Single source of truth for common areas.
 *
 *  New (Distribution) model — active whenever the project has a Residential
 *  GFA target in Setup: the three groups are derived live from the
 *  residentialBreakdown percentages, so they can never go stale when Setup
 *  changes after the last Distribution edit. Amenities + Circulation count
 *  as GFA; Services is BUA-only.
 *
 *  Legacy model — projects predating the Distribution tab (e.g. the
 *  Production City sample) have no gfaBreakdown and instead carry an explicit
 *  `commonAreas` row list. For those we keep summing the persisted rows
 *  (area × floors, split by category) exactly as before. */
export function deriveCommonAreas(project: Project): DerivedCommonAreas {
  const resGFA = residentialGFAOf(project);

  if (resGFA > 0) {
    const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
    const amenitiesGFA = ((rb.amenities?.pct ?? 0) / 100) * resGFA;
    const circulationGFA = ((rb.circulation?.pct ?? 0) / 100) * resGFA;
    const servicesBUA = ((rb.services?.pct ?? 0) / 100) * resGFA;
    return {
      commonAreasGFA: amenitiesGFA + circulationGFA,
      commonAreasBUAonly: servicesBUA,
      commonAreasOpen: 0,
      amenitiesGFA,
      circulationGFA,
      servicesArea: servicesBUA,
      flat: [
        { id: "ca-amenities",   name: "Amenities",   area: Number(amenitiesGFA.toFixed(2)),   floors: 1, category: "GFA" },
        { id: "ca-circulation", name: "Circulation", area: Number(circulationGFA.toFixed(2)), floors: 1, category: "GFA" },
        { id: "ca-services",    name: "Services",    area: Number(servicesBUA.toFixed(2)),    floors: 1, category: "BUA" },
      ],
    };
  }

  // ---- Legacy path: explicit row list ----
  const circulationKeywords = /lobby|corridor|stair|lift|circulation/i;
  const servicesKeywords = /mep|service|pump|electric/i;
  let commonAreasGFA = 0;
  let commonAreasBUAonly = 0;
  let commonAreasOpen = 0;
  let amenitiesGFA = 0;
  let circulationGFA = 0;
  let servicesArea = 0;
  for (const c of project.commonAreas) {
    const total = (c.area || 0) * (c.floors || 1);
    const cat = commonAreaCategory(c);
    if (cat === "GFA") {
      commonAreasGFA += total;
      if (circulationKeywords.test(c.name)) circulationGFA += total;
      else if (servicesKeywords.test(c.name)) servicesArea += total;
      else amenitiesGFA += total;
    } else if (cat === "BUA") {
      commonAreasBUAonly += total;
    } else {
      commonAreasOpen += total;
    }
  }
  return {
    commonAreasGFA,
    commonAreasBUAonly,
    commonAreasOpen,
    amenitiesGFA,
    circulationGFA,
    servicesArea,
    flat: project.commonAreas,
  };
}
