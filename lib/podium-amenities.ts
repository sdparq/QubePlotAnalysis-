import type { Point } from "./geom";
import { isCounterClockwise, pointToPolygonDistance } from "./geom";

/** A rectangular amenity footprint on the podium roof deck. */
export interface PlacedAmenity {
  /** Centre of the rectangle, in plot-local metres. */
  center: Point;
  /** Extent along the podium edge it sits against (m). */
  length: number;
  /** Extent perpendicular to that edge, toward the building interior (m). */
  width: number;
  /** Rotation (radians) aligning local +X with the edge direction. */
  yaw: number;
}

export interface PodiumAmenityPlan {
  pool: PlacedAmenity | null;
  lounge: PlacedAmenity | null;
}

interface SizeSpec {
  minDepth: number;
  margin: number;
  minLen: number;
  maxLen: number;
  minW: number;
  maxW: number;
}

const POOL: SizeSpec = { minDepth: 5, margin: 1.2, minLen: 8, maxLen: 25, minW: 4, maxW: 8 };
const LOUNGE: SizeSpec = { minDepth: 3.5, margin: 0.8, minLen: 6, maxLen: 14, minW: 3, maxW: 5 };
/** Never use more than this share of an edge's length — keeps clear margins at the corners. */
const EDGE_UTILISATION = 0.7;
/** Gap left between the pool and the lounge when they share the same edge. */
const SHARED_EDGE_GAP = 2;

interface Candidate {
  a: Point;
  ux: number;
  uy: number;
  inX: number;
  inY: number;
  length: number;
  /** Clear distance from this edge to the obstruction polygon (Infinity if there is none). */
  depth: number;
  yaw: number;
}

function buildCandidates(deckOuter: Point[], obstruction: Point[]): Candidate[] {
  const ccw = isCounterClockwise(deckOuter);
  const outSign = ccw ? 1 : -1;
  const out: Candidate[] = [];
  for (let i = 0; i < deckOuter.length; i++) {
    const a = deckOuter[i];
    const b = deckOuter[(i + 1) % deckOuter.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length = Math.hypot(ex, ey);
    if (length < 1) continue;
    const ux = ex / length;
    const uy = ey / length;
    const outX = uy * outSign;
    const outY = -ux * outSign;

    let depth = Infinity;
    if (obstruction.length >= 3) {
      depth = Infinity;
      const samples = 6;
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const p = { x: a.x + ex * t, y: a.y + ey * t };
        const d = pointToPolygonDistance(p, obstruction);
        if (d < depth) depth = d;
      }
    }

    out.push({ a, ux, uy, inX: -outX, inY: -outY, length, depth, yaw: Math.atan2(uy, ux) });
  }
  return out;
}

/** The widest the amenity can be within its available depth, or null if it can't meet spec.minDepth/minW. */
function widthFor(depth: number, spec: SizeSpec): number | null {
  const usable = Number.isFinite(depth) ? depth - spec.margin * 2 : spec.maxW;
  const width = Math.min(spec.maxW, Math.max(spec.minW, usable));
  if (width < spec.minW) return null;
  if (Number.isFinite(depth) && depth < spec.minDepth) return null;
  return width;
}

function placeOnEdge(c: Candidate, spec: SizeSpec, width: number, along: number, length: number): PlacedAmenity {
  const midT = along + length / 2;
  return {
    center: {
      x: c.a.x + c.ux * midT + c.inX * (spec.margin + width / 2),
      y: c.a.y + c.uy * midT + c.inY * (spec.margin + width / 2),
    },
    length,
    width,
    yaw: c.yaw,
  };
}

/**
 * Plans a swimming pool and/or a lounge + BBQ terrace on the podium roof deck
 * (the ring of podium footprint left exposed once the tower — set back
 * further — rises above it). Pure geometry, no rendering: picks the podium
 * edge(s) with the most clearance from the tower footprint, and only places
 * an amenity when it actually fits at a sensible minimum size. Returns
 * `null` for whichever amenity has nowhere to go.
 */
export function planPodiumAmenities(
  deckOuter: Point[],
  obstruction: Point[],
  want: { pool: boolean; lounge: boolean },
): PodiumAmenityPlan {
  if (deckOuter.length < 3 || (!want.pool && !want.lounge)) return { pool: null, lounge: null };
  const candidates = buildCandidates(deckOuter, obstruction);
  if (candidates.length === 0) return { pool: null, lounge: null };

  let pool: PlacedAmenity | null = null;
  let poolEdgeIndex = -1;
  if (want.pool) {
    const ranked = candidates
      .map((c, idx) => ({ c, idx, width: widthFor(c.depth, POOL) }))
      .filter((r): r is { c: Candidate; idx: number; width: number } => r.width !== null && r.c.length * EDGE_UTILISATION >= POOL.minLen)
      .sort((p, q) => q.c.depth - p.c.depth);
    if (ranked.length > 0) {
      const { c, idx, width } = ranked[0];
      const length = Math.min(POOL.maxLen, Math.max(POOL.minLen, c.length * EDGE_UTILISATION));
      const along = (c.length - length) / 2;
      pool = placeOnEdge(c, POOL, width, along, length);
      poolEdgeIndex = idx;
    }
  }

  let lounge: PlacedAmenity | null = null;
  if (want.lounge) {
    // First choice: share the pool's edge if there's room alongside it —
    // reads as one continuous amenity terrace rather than two disconnected boxes.
    if (pool && poolEdgeIndex >= 0) {
      const c = candidates[poolEdgeIndex];
      const width = widthFor(c.depth, LOUNGE);
      if (width !== null) {
        const usableLen = c.length * EDGE_UTILISATION;
        const loungeLen = Math.min(LOUNGE.maxLen, usableLen - pool.length - SHARED_EDGE_GAP);
        if (loungeLen >= LOUNGE.minLen) {
          const totalLen = pool.length + SHARED_EDGE_GAP + loungeLen;
          const start = (c.length - totalLen) / 2;
          lounge = placeOnEdge(c, LOUNGE, width, start + pool.length + SHARED_EDGE_GAP, loungeLen);
          // Re-centre the pool to sit alongside the lounge as one shared block
          // rather than independently centred on the full edge.
          pool = placeOnEdge(c, POOL, pool.width, start, pool.length);
        }
      }
    }
    // Otherwise, the next best qualifying edge that isn't the pool's.
    if (!lounge) {
      const ranked = candidates
        .map((c, idx) => ({ c, idx, width: widthFor(c.depth, LOUNGE) }))
        .filter((r): r is { c: Candidate; idx: number; width: number } =>
          r.idx !== poolEdgeIndex && r.width !== null && r.c.length * EDGE_UTILISATION >= LOUNGE.minLen)
        .sort((p, q) => q.c.depth - p.c.depth);
      if (ranked.length > 0) {
        const { c, width } = ranked[0];
        const length = Math.min(LOUNGE.maxLen, Math.max(LOUNGE.minLen, c.length * EDGE_UTILISATION));
        const along = (c.length - length) / 2;
        lounge = placeOnEdge(c, LOUNGE, width, along, length);
      }
    }
  }

  return { pool, lounge };
}
