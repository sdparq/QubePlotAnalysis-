import { edgeLengths, type Point } from "./geom";
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

/** Try to determine the plot's real-world scale by matching printed dimension
 *  labels (from `extractEdgeLabels`) to the nearest edge of the given polygon
 *  (in the same pixel space). Returns null when there isn't enough signal —
 *  callers should fall back to manual 2-point calibration in that case. */
export function tryAutoCalibrate(polygonPx: Point[], textItems: PdfTextItem[]): AutoCalibrationResult | null {
  if (polygonPx.length < 3) return null;
  const labels = extractEdgeLabels(textItems);
  if (labels.length === 0) return null;

  const lens = edgeLengths(polygonPx);
  const avgLen = lens.reduce((s, l) => s + l, 0) / lens.length;
  const threshold = Math.max(15, avgLen * 0.35);

  const matches: EdgeCalibrationMatch[] = [];
  for (let i = 0; i < polygonPx.length; i++) {
    const a = polygonPx[i];
    const b = polygonPx[(i + 1) % polygonPx.length];
    let best: { label: EdgeLabel; dist: number } | null = null;
    for (const label of labels) {
      const d = pointToSegmentDistance({ x: label.x, y: label.y }, a, b);
      if (d <= threshold && (!best || d < best.dist)) best = { label, dist: d };
    }
    if (best && lens[i] > 0) {
      matches.push({
        edgeIndex: i,
        labelText: best.label.text,
        labelMetres: best.label.metres,
        pixelLength: lens[i],
        impliedScale: best.label.metres / lens[i],
      });
    }
  }

  if (matches.length < 2) return null;

  const scales = matches.map((m) => m.impliedScale).sort((a, b) => a - b);
  const mid = scales.length / 2;
  const median = scales.length % 2 === 0 ? (scales[mid - 1] + scales[mid]) / 2 : scales[Math.floor(mid)];
  const maxDeviation = median > 0 ? Math.max(...scales.map((s) => Math.abs(s - median) / median)) : 1;

  return {
    scale: median,
    matches,
    totalEdges: polygonPx.length,
    deviationPct: maxDeviation * 100,
    confident: matches.length >= 2 && maxDeviation < 0.08,
  };
}
