import { edgeLengths, polygonArea, polygonCentroid, type Point } from "./geom";
import type { PdfTextItem } from "./parcel-extract";

/** Matches "51.49 (168.93 ft)" style dimension labels used on Dubai DLD
 *  affection plans — captures the metres value. Deliberately strict (requires
 *  the "(… ft)" companion) so we don't mistake plain coordinates or road-width
 *  callouts ("ROAD 24.38") for edge lengths. */
const EDGE_LABEL_RE = /(\d{1,4}\.\d{1,2})\s*\(\s*\d{1,4}\.\d{1,2}\s*ft\)?/i;

/** Two consecutive text runs are considered part of the same label if their
 *  origins are within this many pixels of each other. PDF generators
 *  sometimes split one printed label ("51.49 " / "(168.93" / " ft)") into
 *  several text-positioning operations. */
const MERGE_DISTANCE_PX = 40;

interface EdgeLabel {
  text: string;
  x: number;
  y: number;
  metres: number;
}

/** Best-effort extraction of edge-length labels from a PDF's raw text runs.
 *  Tries each run on its own first, then short merges of up to 4 consecutive
 *  nearby runs (handles labels split across positioning operators). */
export function extractEdgeLabels(items: PdfTextItem[]): EdgeLabel[] {
  const out: EdgeLabel[] = [];
  for (let i = 0; i < items.length; i++) {
    const single = items[i].text.trim();
    const m1 = EDGE_LABEL_RE.exec(single);
    if (m1) {
      out.push({ text: single, x: items[i].x, y: items[i].y, metres: parseFloat(m1[1]) });
      continue;
    }
    for (let span = 2; span <= 4 && i + span - 1 < items.length; span++) {
      const group = items.slice(i, i + span);
      let close = true;
      for (let k = 1; k < group.length; k++) {
        const d = Math.hypot(group[k].x - group[k - 1].x, group[k].y - group[k - 1].y);
        if (d > MERGE_DISTANCE_PX) { close = false; break; }
      }
      if (!close) continue;
      const merged = group.map((g) => g.text).join("").replace(/\s+/g, " ");
      const m2 = EDGE_LABEL_RE.exec(merged);
      if (m2) {
        out.push({ text: merged.trim(), x: group[0].x, y: group[0].y, metres: parseFloat(m2[1]) });
        break;
      }
    }
  }
  return out;
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

export interface EdgeCalibrationMatch {
  edgeIndex: number;
  labelText: string;
  labelMetres: number;
  pixelLength: number;
  /** metres implied by this edge alone (labelMetres / pixelLength). */
  impliedScale: number;
}

export interface AutoCalibrationResult {
  /** metres per pixel — median across matched edges. */
  scale: number;
  matches: EdgeCalibrationMatch[];
  totalEdges: number;
  /** Max relative deviation of any matched edge's implied scale from the median. */
  deviationPct: number;
  /** True when enough edges matched and they agree closely enough to trust
   *  without a manual double-check. Callers should still show the matches
   *  for visual confirmation before applying. */
  confident: boolean;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

/** Relative tolerance for an (edge, label) pair to count as consistent with a
 *  scale hypothesis. Covers label rounding (cm precision) and polygon
 *  simplification jitter. */
const SCALE_CONSENSUS_TOL = 0.06;

/** Try to determine the plot's real-world scale by matching printed dimension
 *  labels (from `extractEdgeLabels`) to the edges of the given polygon (same
 *  pixel space).
 *
 *  The drawing scale is global, so we use RANSAC-style consensus: every
 *  nearby (edge, label) pair proposes a scale hypothesis (metres ÷ pixel
 *  length); each hypothesis is scored by how many edges can be assigned a
 *  label one-to-one whose implied scale agrees within tolerance; the best
 *  hypothesis wins and its inlier set becomes the match list. This survives
 *  the common DLD situation where the highlighted (balance-area) polygon has
 *  fewer edges than the dimensioned plot boundary, so some labels sit closest
 *  to the wrong edge — proximity alone used to mis-assign those and wreck the
 *  scale. Returns null when there isn't enough signal — callers fall back to
 *  manual 2-point calibration. */
export function tryAutoCalibrate(polygonPx: Point[], textItems: PdfTextItem[]): AutoCalibrationResult | null {
  if (polygonPx.length < 3) return null;
  const labels = extractEdgeLabels(textItems);
  if (labels.length === 0) return null;

  const lens = edgeLengths(polygonPx);
  const avgLen = lens.reduce((s, l) => s + l, 0) / lens.length;
  // Dimension labels are printed right beside their edge (a couple of text
  // heights away at most). The absolute cap keeps far-away cotas — e.g. a
  // coincidentally-matching number from another edge — out of the consensus.
  const threshold = Math.max(20, Math.min(60, avgLen * 0.35));

  // All (edge, label) pairs within reach.
  const pairs: Array<{ edgeIndex: number; label: EdgeLabel; dist: number; scale: number }> = [];
  for (let i = 0; i < polygonPx.length; i++) {
    if (lens[i] <= 0) continue;
    const a = polygonPx[i];
    const b = polygonPx[(i + 1) % polygonPx.length];
    for (const label of labels) {
      const d = pointToSegmentDistance({ x: label.x, y: label.y }, a, b);
      if (d <= threshold) pairs.push({ edgeIndex: i, label, dist: d, scale: label.metres / lens[i] });
    }
  }
  if (pairs.length === 0) return null;

  // Evaluate every pair's scale as a hypothesis: greedy 1:1 assignment (by
  // distance) restricted to pairs whose implied scale agrees with it.
  function inliersFor(hypothesis: number): Array<{ edgeIndex: number; label: EdgeLabel; dist: number; scale: number }> {
    const usable = pairs
      .filter((p) => Math.abs(p.scale - hypothesis) / hypothesis <= SCALE_CONSENSUS_TOL)
      .sort((a, b) => a.dist - b.dist);
    const usedEdges = new Set<number>();
    const usedLabels = new Set<EdgeLabel>();
    const out: typeof usable = [];
    for (const p of usable) {
      if (usedEdges.has(p.edgeIndex) || usedLabels.has(p.label)) continue;
      usedEdges.add(p.edgeIndex);
      usedLabels.add(p.label);
      out.push(p);
    }
    return out;
  }

  let best: ReturnType<typeof inliersFor> = [];
  let bestDist = Infinity;
  for (const candidate of pairs) {
    const inliers = inliersFor(candidate.scale);
    const totalDist = inliers.reduce((s, p) => s + p.dist, 0);
    if (inliers.length > best.length || (inliers.length === best.length && totalDist < bestDist)) {
      best = inliers;
      bestDist = totalDist;
    }
  }

  if (best.length < 2) return null;

  const matches: EdgeCalibrationMatch[] = best
    .map((p) => ({
      edgeIndex: p.edgeIndex,
      labelText: p.label.text,
      labelMetres: p.label.metres,
      pixelLength: lens[p.edgeIndex],
      impliedScale: p.scale,
    }))
    .sort((a, b) => a.edgeIndex - b.edgeIndex);

  const median = medianOf(matches.map((m) => m.impliedScale));
  const maxDeviation =
    median > 0 ? Math.max(...matches.map((m) => Math.abs(m.impliedScale - median) / median)) : 1;

  return {
    scale: median,
    matches,
    totalEdges: polygonPx.length,
    deviationPct: maxDeviation * 100,
    // ≥3 agreeing edges is very unlikely by chance; 2 could coincide, so a
    // 2-edge consensus is shown for review instead of applied automatically.
    confident: matches.length >= 3 && maxDeviation < 0.08,
  };
}

/* ---------------------- Apply helpers (pure) ---------------------- */

/** Convert a traced pixel polygon into plot-local metres: scale, flip Y so the
 *  visual top becomes +y, recentre on the centroid. */
export function polygonPxToMetres(polygonPx: Point[], scale: number): { plotPolygon: Point[]; areaM2: number } {
  const inMetres = polygonPx.map((p) => ({ x: p.x * scale, y: -p.y * scale }));
  const c = polygonCentroid(inMetres);
  const plotPolygon = inMetres.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  return { plotPolygon, areaM2: polygonArea(plotPolygon) };
}

/** Pick the matched edge whose implied scale sits closest to the applied
 *  median, and express it as the p1/p2/metres calibration record the rest of
 *  the app persists. metres is derived from the applied scale so the record
 *  stays exactly self-consistent. */
export function pickReferenceEdge(
  result: AutoCalibrationResult,
  polygonPx: Point[],
): { p1: Point; p2: Point; metres: number } {
  const best = [...result.matches].sort(
    (a, b) => Math.abs(a.impliedScale - result.scale) - Math.abs(b.impliedScale - result.scale),
  )[0];
  const p1 = polygonPx[best.edgeIndex];
  const p2 = polygonPx[(best.edgeIndex + 1) % polygonPx.length];
  return { p1, p2, metres: result.scale * best.pixelLength };
}
