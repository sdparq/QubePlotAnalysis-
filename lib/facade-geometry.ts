import type { Point } from "./geom";
import { isCounterClockwise, offsetPolygon, polygonCentroid } from "./geom";

/*
 * Plan geometry of the designed façades: rounded tower corners, the façade
 * module grid that mullions, fins and glass panes sit on, and the rooftop
 * layout. Pure functions in plan metres — no three.js.
 */

/**
 * Rounds the convex corners of a polygon with arcs of `radius` (shrunk where
 * an edge is too short); re-entrant corners stay sharp.
 */
export function filletPolygon(poly: Point[], radius: number, segmentsPerQuarter = 6): Point[] {
  const n = poly.length;
  if (n < 3 || radius <= 0) return poly;
  const ccw = isCounterClockwise(poly);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const l1 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (l1 < 1e-6 || l2 < 1e-6) {
      out.push(p1);
      continue;
    }
    const d1 = { x: (p0.x - p1.x) / l1, y: (p0.y - p1.y) / l1 };
    const d2 = { x: (p2.x - p1.x) / l2, y: (p2.y - p1.y) / l2 };
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    const convex = ccw ? cross > 0 : cross < 0;
    const angle = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
    if (!convex || angle > Math.PI - 0.08 || angle < 0.05) {
      out.push(p1);
      continue;
    }
    const tanHalf = Math.tan(angle / 2);
    let t = radius / tanHalf;
    let r = radius;
    const tMax = 0.45 * Math.min(l1, l2);
    if (t > tMax) {
      t = tMax;
      r = t * tanHalf;
    }
    if (r < 0.1) {
      out.push(p1);
      continue;
    }
    const a = { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
    const b = { x: p1.x + d2.x * t, y: p1.y + d2.y * t };
    const bl = Math.hypot(d1.x + d2.x, d1.y + d2.y) || 1;
    const cd = r / Math.sin(angle / 2);
    const c = { x: p1.x + ((d1.x + d2.x) / bl) * cd, y: p1.y + ((d1.y + d2.y) / bl) * cd };
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    let sweep = Math.atan2(b.y - c.y, b.x - c.x) - a0;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const segs = Math.max(2, Math.round((segmentsPerQuarter * Math.abs(sweep)) / (Math.PI / 2)));
    for (let k = 0; k <= segs; k++) {
      const ang = a0 + (sweep * k) / segs;
      out.push({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r });
    }
  }
  return out;
}

/** A point on a façade line, with its tangent and outward normal (plan). */
export interface Station {
  x: number;
  y: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  /** Sits on a sharp corner — the normal is the corner's bisector. */
  corner: boolean;
  /** Arc length from the outline's first vertex. */
  s: number;
  /** Index within its straight/curved run. */
  k: number;
}

/** A flat façade module between two consecutive stations. */
export interface Panel {
  x: number;
  y: number;
  ux: number;
  uy: number;
  len: number;
}

/**
 * Divides an outline into façade modules of about `module` metres. Sharp
 * corners always get a station; smooth runs (arcs of rounded corners) are
 * divided evenly along their length, so modules wrap round curves.
 */
export function facadeGrid(outline: Point[], module: number): { stations: Station[]; panels: Panel[]; perimeter: number } {
  const n = outline.length;
  if (n < 3) return { stations: [], panels: [], perimeter: 0 };
  const outSign = isCounterClockwise(outline) ? 1 : -1;
  const edges = outline
    .map((a, i) => {
      const b = outline[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      return { a, len, ux: len > 0 ? (b.x - a.x) / len : 1, uy: len > 0 ? (b.y - a.y) / len : 0, s0: 0 };
    })
    .filter((e) => e.len > 1e-4);
  const m = edges.length;
  if (m < 3) return { stations: [], panels: [], perimeter: 0 };
  let acc = 0;
  for (const e of edges) {
    e.s0 = acc;
    acc += e.len;
  }
  const perimeter = acc;
  const cos30 = Math.cos((30 * Math.PI) / 180);
  const sharp = edges.map((e, i) => {
    const p = edges[(i - 1 + m) % m];
    return p.ux * e.ux + p.uy * e.uy < cos30;
  });
  const starts = sharp.flatMap((v, i) => (v ? [i] : []));
  const runs: number[][] = [];
  if (starts.length === 0) runs.push(edges.map((_, i) => i));
  else {
    starts.forEach((from, r) => {
      const to = starts[(r + 1) % starts.length];
      const run: number[] = [];
      let i = from;
      do {
        run.push(i);
        i = (i + 1) % m;
      } while (i !== to);
      runs.push(run);
    });
  }

  const stations: Station[] = [];
  const panels: Panel[] = [];
  const unit = Math.max(0.3, module);
  for (const run of runs) {
    const L = run.reduce((sum, i) => sum + edges[i].len, 0);
    const count = Math.max(1, Math.round(L / unit));
    const step = L / count;
    const at = (s: number) => {
      let rest = Math.min(Math.max(0, s), L);
      for (let j = 0; j < run.length; j++) {
        const e = edges[run[j]];
        if (rest <= e.len + 1e-9 || j === run.length - 1) {
          const t = Math.min(rest, e.len);
          return { x: e.a.x + e.ux * t, y: e.a.y + e.uy * t, ux: e.ux, uy: e.uy, s: e.s0 + t };
        }
        rest -= e.len;
      }
      const e = edges[run[0]];
      return { x: e.a.x, y: e.a.y, ux: e.ux, uy: e.uy, s: e.s0 };
    };
    const pts = Array.from({ length: count + 1 }, (_, k) => at(k * step));
    const first = edges[run[0]];
    const prev = edges[(run[0] - 1 + m) % m];
    for (let k = 0; k < count; k++) {
      const p = pts[k];
      let nx = p.uy * outSign;
      let ny = -p.ux * outSign;
      const corner = k === 0 && starts.length > 0;
      if (corner) {
        const bx = first.uy * outSign + prev.uy * outSign;
        const by = -first.ux * outSign - prev.ux * outSign;
        const bl = Math.hypot(bx, by) || 1;
        nx = bx / bl;
        ny = by / bl;
      }
      stations.push({ x: p.x, y: p.y, ux: -ny * outSign, uy: nx * outSign, nx, ny, corner, s: p.s, k });
      const q = pts[k + 1];
      const cx = q.x - p.x;
      const cy = q.y - p.y;
      const len = Math.hypot(cx, cy);
      if (len > 1e-4) panels.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, ux: cx / len, uy: cy / len, len });
    }
  }
  return { stations, panels, perimeter };
}

export interface RoofRect {
  x: number;
  y: number;
  len: number;
  wid: number;
  yaw: number;
  /** Along (u) and across (v) unit vectors, plan. */
  ux: number;
  uy: number;
  vx: number;
  vy: number;
}

function pointInPolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Sky pool and lounge pavilion on the roof, laid along the longest side: the
 * pool on the side facing the aerial camera (plan south-east), the pavilion
 * behind it, both shrunk until they sit inside the roof with a clear margin.
 */
export function roofLayout(outline: Point[]): { pool: RoofRect | null; core: RoofRect | null } {
  if (outline.length < 3) return { pool: null, core: null };
  let best = 0;
  let ux = 1;
  let uy = 0;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      ux = (b.x - a.x) / len;
      uy = (b.y - a.y) / len;
    }
  });
  let vx = -uy;
  let vy = ux;
  if (vx * 0.6 - vy * 0.8 < 0) {
    vx = -vx;
    vy = -vy;
  }
  const c = polygonCentroid(outline);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of outline) {
    const du = (p.x - c.x) * ux + (p.y - c.y) * uy;
    const dv = (p.x - c.x) * vx + (p.y - c.y) * vy;
    u0 = Math.min(u0, du);
    u1 = Math.max(u1, du);
    v0 = Math.min(v0, dv);
    v1 = Math.max(v1, dv);
  }
  const U = u1 - u0;
  const V = v1 - v0;
  const uMid = (u0 + u1) / 2;
  const yaw = yawOf(ux, uy);
  const safe = grow(outline, -1.4);
  const place = (dv: number, len: number, wid: number): RoofRect => ({
    x: c.x + ux * uMid + vx * dv,
    y: c.y + uy * uMid + vy * dv,
    len, wid, yaw, ux, uy, vx, vy,
  });
  const fits = (r: RoofRect) =>
    [-0.5, 0.5].every((a) =>
      [-0.5, 0.5].every((b) =>
        pointInPolygon({ x: r.x + ux * a * r.len + vx * b * r.wid, y: r.y + uy * a * r.len + vy * b * r.wid }, safe),
      ),
    );

  let core: RoofRect | null = null;
  for (let k = 0, s = 1; k < 6 && !core; k++, s *= 0.85) {
    const wid = clamp(V * 0.3, 4, 10) * s;
    const cand = place(v0 + 2.2 + wid / 2, clamp(U * 0.34, 6, 18) * s, wid);
    if (fits(cand)) core = cand;
  }
  const coreEdge = core ? v0 + 2.2 + core.wid : v0 + 1.5;
  let pool: RoofRect | null = null;
  for (let k = 0, s = 1; k < 6 && !pool; k++, s *= 0.85) {
    const wid = clamp(V * 0.24, 3.5, 8) * s;
    const dv = v1 - 2.2 - wid / 2;
    if (dv - wid / 2 - 2.6 < coreEdge) continue; // keep room for loungers
    const cand = place(dv, clamp(U * 0.56, 8, 28) * s, wid);
    if (fits(cand)) pool = cand;
  }
  return { pool, core };
}

function grow(outline: Point[], d: number): Point[] {
  if (Math.abs(d) < 1e-6) return outline;
  const r = offsetPolygon(outline, -d);
  return r.length >= 3 ? r : outline;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const yawOf = (ux: number, uy: number) => Math.atan2(uy, ux);
