import type { Project } from "./types";
import { type Point, offsetPolygon, rectanglePlotPolygon, translatePolygon } from "./geom";

/**
 * Footprint of each tier (ground / podium / tower) — one place decides it,
 * for Plot, Massing and the 3D.
 *
 * Every tier has a MODE (Project.tierMode):
 *   - "setbacks": the plot line offset inward by the tier's setbacks
 *   - "traced":   the blocks traced on the plan in Plot
 *   - another tier's name: the SAME geometry as that tier, live — when the
 *     other tier changes, this one follows
 * No stored mode = the historical rule: traced blocks win, else setbacks.
 * The tower offset (Massing) is the tower's own, applied last.
 */
export type TierKey = "ground" | "podium" | "tower";
export type TierMode = "setbacks" | "traced" | TierKey;
export const TIER_KEYS: TierKey[] = ["ground", "podium", "tower"];
export const DEFAULT_SETBACK_M: Record<TierKey, number> = { ground: 3, podium: 3, tower: 6 };

/** The plot polygon in plot-local metres (traced polygon, else the rectangle). */
export function plotPolygonOf(project: Project): Point[] {
  if (project.plotMode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
    return project.plotPolygon;
  }
  const side = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : side;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : side;
  return rectanglePlotPolygon(frontage, depth);
}

/** Blocks traced for a tier (the legacy single polygon counts as block #1). */
export function tracedBlocks(project: Project, tier: TierKey): Point[][] {
  const plural =
    tier === "ground" ? project.groundPolygons : tier === "podium" ? project.podiumPolygons : project.towerPolygons;
  const single =
    tier === "ground" ? project.groundPolygon : tier === "podium" ? project.podiumPolygon : project.towerPolygon;
  return (plural ?? (single ? [single] : [])).filter((poly) => (poly?.length ?? 0) >= 3);
}

export function uniformSetback(project: Project, tier: TierKey): number {
  const v =
    tier === "ground" ? project.groundSetbackM : tier === "podium" ? project.podiumSetbackM : project.towerSetbackM;
  return Math.max(0, v ?? DEFAULT_SETBACK_M[tier]);
}

/** Per-edge setbacks of a tier: the stored array when it matches the plot,
 *  else the uniform value on every edge. */
export function tierSetbacks(project: Project, plot: Point[], tier: TierKey): number[] {
  const perEdge =
    tier === "ground"
      ? project.groundSetbackPerEdge
      : tier === "podium"
        ? project.podiumSetbackPerEdge
        : project.towerSetbackPerEdge;
  if (perEdge && perEdge.length === plot.length) return perEdge.map((v) => Math.max(0, v));
  const u = uniformSetback(project, tier);
  return plot.map(() => u);
}

export function setbackPolygon(plot: Point[], setbacks: number[]): Point[] {
  if (plot.length < 3) return plot;
  if (setbacks.every((s) => s <= 0)) return plot;
  return offsetPolygon(plot, setbacks);
}

/** The tier whose own geometry `tier` ends up using, following "same as"
 *  links. A loop (A = B, B = A) falls back to the tier itself. */
export function tierOrigin(project: Project, tier: TierKey): TierKey {
  const seen = new Set<TierKey>([tier]);
  let cur = tier;
  for (;;) {
    const m = project.tierMode?.[cur];
    if (m !== "ground" && m !== "podium" && m !== "tower") return cur;
    if (m === cur) return cur;
    if (seen.has(m)) return tier;
    seen.add(m);
    cur = m;
  }
}

/** Would making `tier` follow `target` close a loop? */
export function wouldLoop(project: Project, tier: TierKey, target: TierKey): boolean {
  if (tier === target) return true;
  let cur: TierKey = target;
  const seen = new Set<TierKey>();
  for (;;) {
    if (cur === tier) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const m = project.tierMode?.[cur];
    if (m !== "ground" && m !== "podium" && m !== "tower") return false;
    cur = m;
  }
}

export interface ResolvedTier {
  /** What the user chose for this tier, with the fallbacks applied. */
  mode: TierMode;
  /** Tier whose own geometry is used (itself unless it follows another). */
  origin: TierKey;
  /** Where that geometry comes from. */
  source: "setbacks" | "traced";
  polygons: Point[][];
  /** This tier's OWN per-edge setbacks (used only when source is setbacks and origin is itself). */
  setbacks: number[];
}

function ownMode(project: Project, tier: TierKey): "setbacks" | "traced" {
  const m = project.tierMode?.[tier];
  const has = tracedBlocks(project, tier).length > 0;
  if (m === "setbacks") return "setbacks";
  // "traced" with nothing traced yet, or no stored mode: traced blocks win when present.
  return has ? "traced" : "setbacks";
}

export function resolveTiers(project: Project, plot: Point[] = plotPolygonOf(project)): Record<TierKey, ResolvedTier> {
  const dx = project.towerOffsetXM ?? 0;
  const dy = project.towerOffsetYM ?? 0;
  const own = (tier: TierKey) => {
    const source = ownMode(project, tier);
    const polygons =
      source === "traced" ? tracedBlocks(project, tier) : [setbackPolygon(plot, tierSetbacks(project, plot, tier))];
    return { source, polygons };
  };
  const out = {} as Record<TierKey, ResolvedTier>;
  for (const tier of TIER_KEYS) {
    const origin = tierOrigin(project, tier);
    const base = own(origin);
    // The offset belongs to the tower: it moves the tower's own geometry (and
    // whoever copies the tower), and a tower that copies another tier.
    const shifted = (tier === "tower" || origin === "tower") && (dx !== 0 || dy !== 0);
    out[tier] = {
      mode: origin !== tier ? origin : base.source,
      origin,
      source: base.source,
      polygons: shifted ? base.polygons.map((poly) => translatePolygon(poly, dx, dy)) : base.polygons,
      setbacks: tierSetbacks(project, plot, tier),
    };
  }
  return out;
}
