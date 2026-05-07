export type Point = { x: number; y: number };

export function polygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a / 2);
}

export function polygonCentroid(poly: Point[]): Point {
  if (poly.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    a += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return { x: cx, y: cy };
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function isCounterClockwise(poly: Point[]): boolean {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a > 0;
}

export function edgeLengths(poly: Point[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    r.push(Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y));
  }
  return r;
}

export function polygonPerimeter(poly: Point[]): number {
  return edgeLengths(poly).reduce((s, l) => s + l, 0);
}

export function polygonBBox(poly: Point[]) {
  if (poly.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0, cx: 0, cy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function lineLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * Inward polygon offset using edge normals + line intersections.
 * `distance` may be a single number (uniform) or an array (one per edge — index i is the
 * offset of the edge going from vertex i to vertex i+1).
 * Works robustly for convex polygons; concave polygons may produce artifacts at re-entrant corners.
 * Returns [] if the inset collapses or self-intersects.
 */
export function offsetPolygon(poly: Point[], distance: number | number[]): Point[] {
  if (poly.length < 3) return [];
  const distArr = Array.isArray(distance) ? distance : poly.map(() => distance);
  if (distArr.every((d) => Math.abs(d) < 1e-9)) return poly.slice();
  const ccw = isCounterClockwise(poly);
  const sign = ccw ? 1 : -1;

  type Edge = { p: Point; dir: Point };
  const offsetEdges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Inward normal: rotate edge direction by +90° for CCW, -90° for CW
    const nx = -uy * sign;
    const ny = ux * sign;
    const d = distArr[i] ?? 0;
    offsetEdges.push({
      p: { x: a.x + nx * d, y: a.y + ny * d },
      dir: { x: ux, y: uy },
    });
  }

  const result: Point[] = [];
  for (let i = 0; i < offsetEdges.length; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % offsetEdges.length];
    const inter = lineLineIntersection(
      e1.p,
      { x: e1.p.x + e1.dir.x, y: e1.p.y + e1.dir.y },
      e2.p,
      { x: e2.p.x + e2.dir.x, y: e2.p.y + e2.dir.y }
    );
    if (inter) result.push(inter);
  }
  if (result.length < 3) return [];
  if (polygonArea(result) < 0.01) return [];
  return result;
}

export function scalePolygon(poly: Point[], scale: number, around?: Point): Point[] {
  const c = around ?? polygonCentroid(poly);
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}

export function scalePolygonToArea(poly: Point[], targetArea: number): Point[] {
  const cur = polygonArea(poly);
  if (cur < 1e-9 || targetArea < 1e-9) return [];
  return scalePolygon(poly, Math.sqrt(targetArea / cur));
}

export function translatePolygon(poly: Point[], dx: number, dy: number): Point[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function rectangleToPolygon(frontage: number, depth: number, sFront = 0, sRear = 0, sSide = 0): Point[] {
  // 2D convention: -y is the FRONT of the plot (rendered toward the camera).
  // sFront eats from the -y edge, sRear eats from the +y edge.
  const halfW = frontage / 2 - sSide;
  const front = -depth / 2 + sFront;
  const rear = depth / 2 - sRear;
  return [
    { x: -halfW, y: front },
    { x: halfW, y: front },
    { x: halfW, y: rear },
    { x: -halfW, y: rear },
  ];
}

export function rectanglePlotPolygon(frontage: number, depth: number): Point[] {
  return [
    { x: -frontage / 2, y: -depth / 2 },
    { x: frontage / 2, y: -depth / 2 },
    { x: frontage / 2, y: depth / 2 },
    { x: -frontage / 2, y: depth / 2 },
  ];
}

/**
 * Clip a subject polygon by a CONVEX clip polygon using Sutherland–Hodgman.
 * Returns the intersection polygon (subject ∩ clip), or [] if the result is empty.
 *
 * Works correctly when the clip polygon is convex. For mildly concave clips the
 * result is close enough for visual purposes, but may include phantom edges —
 * promote to a full clipping library if that becomes an issue.
 */
export function clipPolygonToConvex(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const C = isCounterClockwise(clip) ? clip : clip.slice().reverse();
  let output: Point[] = subject.slice();

  for (let i = 0; i < C.length; i++) {
    if (output.length === 0) return [];
    const A = C[i];
    const B = C[(i + 1) % C.length];
    const input = output;
    output = [];
    let S = input[input.length - 1];
    for (const E of input) {
      const eIn = sideOf(A, B, E) >= -1e-9;
      const sIn = sideOf(A, B, S) >= -1e-9;
      if (eIn) {
        if (!sIn) {
          const inter = lineSegmentIntersection(A, B, S, E);
          if (inter) output.push(inter);
        }
        output.push(E);
      } else if (sIn) {
        const inter = lineSegmentIntersection(A, B, S, E);
        if (inter) output.push(inter);
      }
      S = E;
    }
  }
  return output;
}

function sideOf(A: Point, B: Point, P: Point): number {
  return (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x);
}

function lineSegmentIntersection(A: Point, B: Point, S: Point, E: Point): Point | null {
  const dx = E.x - S.x;
  const dy = E.y - S.y;
  const cross1 = (B.x - A.x) * (S.y - A.y) - (B.y - A.y) * (S.x - A.x);
  const cross2 = (B.x - A.x) * dy - (B.y - A.y) * dx;
  if (Math.abs(cross2) < 1e-9) return null;
  const t = -cross1 / cross2;
  return { x: S.x + t * dx, y: S.y + t * dy };
}

/* ---------- Boolean polygon ops via polygon-clipping ----------
 * polygon-clipping speaks GeoJSON-style nested coords:
 *   ring   = [[x,y], [x,y], ..., [x,y]]   (first point repeated at the end)
 *   poly   = [outerRing, hole1, hole2, ...]
 *   multi  = [poly, poly, ...]
 *
 * Our internal Point[] is a single ring without the closing repeat, so we
 * convert in/out at the boundary. For our massing use cases we want the
 * largest outer ring back, so the helpers return one Point[] (the biggest
 * piece) — convenient for "subject ∩ clip" or "buildable − notch".
 */

type Ring = [number, number][];
type Geom = Ring[][];

function toGeom(poly: Point[]): Geom {
  if (poly.length < 3) return [];
  const ring: Ring = poly.map((p) => [p.x, p.y]);
  // Close the ring as required by polygon-clipping
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return [[ring]];
}

function ringToPoints(ring: Ring): Point[] {
  // Drop the closing repeat
  const pts: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (i === ring.length - 1 && pts.length > 0) {
      const a = ring[i];
      const b = ring[0];
      if (a[0] === b[0] && a[1] === b[1]) break;
    }
    pts.push({ x: ring[i][0], y: ring[i][1] });
  }
  return pts;
}

function pickLargest(g: Geom): Point[] {
  let best: Point[] = [];
  let bestArea = 0;
  for (const poly of g) {
    if (!poly || poly.length === 0) continue;
    const outer = ringToPoints(poly[0]);
    const a = polygonArea(outer);
    if (a > bestArea) {
      bestArea = a;
      best = outer;
    }
  }
  return best;
}

/** Intersection of two polygons. Returns the largest resulting outer ring (or [] if empty). */
export function polygonIntersection(a: Point[], b: Point[]): Point[] {
  if (a.length < 3 || b.length < 3) return [];
  // Lazy load to keep the boundary clean for tree shaking
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pc = require("polygon-clipping") as typeof import("polygon-clipping");
  try {
    const result = pc.intersection(toGeom(a), toGeom(b)) as unknown as Geom;
    return pickLargest(result);
  } catch {
    return [];
  }
}

/** A − B. Returns the largest resulting outer ring (or [] if empty). */
export function polygonDifference(a: Point[], b: Point[]): Point[] {
  if (a.length < 3) return [];
  if (b.length < 3) return a.slice();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pc = require("polygon-clipping") as typeof import("polygon-clipping");
  try {
    const result = pc.difference(toGeom(a), toGeom(b)) as unknown as Geom;
    return pickLargest(result);
  } catch {
    return [];
  }
}

/** Union of two or more polygons. */
export function polygonUnion(...polys: Point[][]): Point[] {
  const valid = polys.filter((p) => p.length >= 3);
  if (valid.length === 0) return [];
  if (valid.length === 1) return valid[0].slice();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pc = require("polygon-clipping") as typeof import("polygon-clipping");
  try {
    const [first, ...rest] = valid;
    const result = pc.union(toGeom(first), ...rest.map(toGeom)) as unknown as Geom;
    return pickLargest(result);
  } catch {
    return [];
  }
}
