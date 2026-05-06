import { type Point, polygonArea, polygonPerimeter } from "./geom";
import { buildMassing, type MassingResult, type MassingShape, type TowerPosition } from "./massing";

export interface VariantParams {
  shape: MassingShape;
  podiumFloors?: number;
  podiumCoverage?: number;
  towerCoverage?: number;
  towerPosition?: TowerPosition;
  courtyardRatio?: number;
  twinSeparation?: number;
  twinCoverage?: number;
  floorArea?: number;
}

export interface VariantScore {
  total: number;        // 0..100
  constraintFit: number;
  gfaFit: number;
  facade: number;
  efficiency: number;
}

export interface Variant {
  id: string;
  label: string;
  params: VariantParams;
  massing: MassingResult;
  totalGFA: number;
  buildingHeight: number;
  perimeter: number;
  avgFootprint: number;
  score: VariantScore;
}

export interface GenerateVariantsInput {
  buildable: Point[];
  effFloors: number;
  effFloorArea: number;
  floorHeight: number;
  programGFA: number;
}

const TOWER_POSITIONS: TowerPosition[] = ["C", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function generateVariants(input: GenerateVariantsInput): Variant[] {
  const { buildable, effFloors, effFloorArea, floorHeight, programGFA } = input;
  const buildableArea = polygonArea(buildable);
  if (buildableArea < 1 || effFloors <= 0) return [];

  const candidates: { id: string; label: string; params: VariantParams }[] = [];

  // --- Block presets ---
  if (effFloorArea > 0 && programGFA > 0) {
    candidates.push({
      id: "block-program",
      label: "Block · fit program",
      params: { shape: "block", floorArea: effFloorArea },
    });
  }
  candidates.push({
    id: "block-max",
    label: "Block · max coverage",
    params: { shape: "block", floorArea: buildableArea },
  });

  // --- Podium + tower presets ---
  const podiumFloors = Math.max(1, Math.min(Math.round(effFloors * 0.3), Math.max(1, effFloors - 1)));
  for (const pos of TOWER_POSITIONS) {
    for (const towerCov of [0.30, 0.45]) {
      candidates.push({
        id: `podium-${pos}-${Math.round(towerCov * 100)}`,
        label: `Podium + tower · ${pos === "C" ? "centred" : pos}${towerCov === 0.30 ? " narrow" : ""}`,
        params: {
          shape: "podiumTower",
          podiumFloors,
          podiumCoverage: 0.95,
          towerCoverage: towerCov,
          towerPosition: pos,
        },
      });
    }
  }

  // --- Courtyard presets ---
  for (const ratio of [0.10, 0.20, 0.30]) {
    candidates.push({
      id: `courtyard-${Math.round(ratio * 100)}`,
      label: `Courtyard · ${Math.round(ratio * 100)}%`,
      params: { shape: "courtyard", courtyardRatio: ratio, floorArea: Math.min(effFloorArea, buildableArea) },
    });
  }

  // --- Twin tower presets ---
  const sep = Math.sqrt(buildableArea) * 0.4;
  for (const cov of [0.20, 0.30]) {
    candidates.push({
      id: `twin-${Math.round(cov * 100)}`,
      label: `Twin towers · ${Math.round(cov * 100)}%`,
      params: { shape: "twinTowers", twinSeparation: sep, twinCoverage: cov },
    });
  }

  // Build massing for each
  const built: Variant[] = candidates.map((c) => {
    const massing = buildMassing({
      buildable,
      effFloors,
      effFloorArea: c.params.floorArea ?? effFloorArea,
      floorHeight,
      shape: c.params.shape,
      podiumFloors: c.params.podiumFloors ?? podiumFloors,
      podiumCoverage: c.params.podiumCoverage ?? 0.95,
      towerCoverage: c.params.towerCoverage ?? 0.4,
      towerPosition: c.params.towerPosition ?? "C",
      courtyardRatio: c.params.courtyardRatio ?? 0.2,
      twinSeparation: c.params.twinSeparation ?? sep,
      twinCoverage: c.params.twinCoverage ?? 0.25,
    });
    const buildingHeight = effFloors * floorHeight;
    const perimeter = massing.volumes.reduce((s, v) => s + polygonPerimeter(v.polygon), 0);
    const avgFootprint =
      buildingHeight > 0
        ? massing.volumes.reduce((s, v) => s + polygonArea(v.polygon) * (v.toY - v.fromY), 0) / buildingHeight
        : 0;
    return {
      id: c.id,
      label: c.label,
      params: c.params,
      massing,
      totalGFA: massing.totalGFA,
      buildingHeight,
      perimeter,
      avgFootprint,
      score: { total: 0, constraintFit: 0, gfaFit: 0, facade: 0, efficiency: 0 },
    };
  });

  // Drop variants that produced nothing
  const valid = built.filter((v) => v.massing.volumes.length > 0 && v.totalGFA > 100);
  if (valid.length === 0) return [];

  // Normalise façade across variants
  const facadeRatios = valid.map((v) => (v.totalGFA > 0 ? v.perimeter / Math.sqrt(v.totalGFA) : 0));
  const maxFacade = Math.max(1, ...facadeRatios);

  for (const v of valid) {
    v.score = scoreVariant(v, buildableArea, programGFA, maxFacade);
  }
  valid.sort((a, b) => b.score.total - a.score.total);
  return valid;
}

function scoreVariant(v: Variant, buildableArea: number, programGFA: number, maxFacade: number): VariantScore {
  let gfaFit = 60;
  if (programGFA > 0) {
    const r = v.totalGFA / programGFA;
    gfaFit = Math.max(0, 100 - Math.abs(r - 1) * 200);
  }
  const fr = v.totalGFA > 0 ? v.perimeter / Math.sqrt(v.totalGFA) : 0;
  const facade = maxFacade > 0 ? Math.max(0, Math.min(100, (fr / maxFacade) * 100)) : 50;
  const cov = buildableArea > 0 ? v.avgFootprint / buildableArea : 0;
  const efficiency = Math.max(0, 100 - Math.abs(cov - 0.6) * 200);
  const constraintFit = 100;
  const total = gfaFit * 0.5 + facade * 0.2 + efficiency * 0.2 + constraintFit * 0.1;
  return {
    total: Math.round(total),
    constraintFit: Math.round(constraintFit),
    gfaFit: Math.round(gfaFit),
    facade: Math.round(facade),
    efficiency: Math.round(efficiency),
  };
}
