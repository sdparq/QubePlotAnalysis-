/**
 * Floor-plan fit ("encaje en planta") — a feasibility-level automatic layout
 * of one tower floor:
 *
 *   · a perimeter strip of units whose depth is solved (bisection on the
 *     inward offset) so the strip area equals the floor's unit programme;
 *   · radial cuts through the strip, each solved so every unit hits its
 *     target area (walking the perimeter, monotone in the cut parameter);
 *   · a communication core (lift bank + two escape stairs + lobby) centred
 *     on the leftover inner zone and aligned with the plate's longest edge.
 *
 * Everything is pure geometry over plot-local metres — no React, no store.
 */
import {
  type Point,
  isCounterClockwise,
  offsetPolygon,
  polygonArea,
  polygonCentroid,
} from "./geom";

export interface UnitSpec {
  id: string;
  /** Short label drawn inside the unit ("1BR · B2"). */
  label: string;
  category: string;
  /** Target interior area, m². */
  area: number;
  /** Balcony area, m² — drawn as a dashed band outside the facade edge. */
  balcony: number;
}

export interface PlacedUnit {
  spec: UnitSpec;
  polygon: Point[];
  areaAchieved: number;
  /** The stretch of building perimeter this unit owns (polyline, outer face). */
  outerChain: Point[];
  /** Dashed balcony band quads outside the facade, when spec.balcony > 0. */
  balconyQuads: Point[][];
}

export interface CoreLayout {
  /** Outer rectangle of the core (4 points, plot-local metres). */
  rect: Point[];
  parts: { kind: "lifts" | "stair" | "lobby"; rect: Point[]; label: string }[];
  areaM2: number;
  /** Rotation applied (radians) — informational. */
  angle: number;
}

export interface FloorPlanResult {
  plate: Point[];
  plateArea: number;
  /** Inner boundary of the unit strip = outer edge of the circulation zone. */
  inner: Point[];
  /** Solved strip depth (m) — distance between plate and inner boundary. */
  stripDepth: number;
  units: PlacedUnit[];
  unitsTargetArea: number;
  unitsAchievedArea: number;
  core: CoreLayout | null;
  /** Inner zone minus core = corridors / lobby on this floor. */
  circulationArea: number;
  warnings: string[];
}

/* ------------------------------ small helpers ----------------------------- */

const EPS = 1e-9;

function ensureCCW(poly: Point[]): Point[] {
  return isCounterClockwise(poly) ? poly.slice() : poly.slice().reverse();
}

function perimeterLengths(poly: Point[]): { lens: number[]; total: number } {
  const lens = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  return { lens, total: lens.reduce((a, b) => a + b, 0) };
}

/** Point at arc-length t along the polygon boundary (t in [0, total)). */
function pointAt(poly: Point[], lens: number[], t: number): { p: Point; edge: number; frac: number } {
  const n = poly.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (t <= acc + lens[i] + EPS) {
      const frac = lens[i] < EPS ? 0 : (t - acc) / lens[i];
      const a = poly[i];
      const b = poly[(i + 1) % n];
      return { p: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }, edge: i, frac };
    }
    acc += lens[i];
  }
  const a = poly[n - 1], b = poly[0];
  return { p: { x: b.x, y: b.y }, edge: n - 1, frac: 1 };
}

/** Shoelace area of an arbitrary ring given as an ordered point list. */
function ringArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/* --------------------------- strip depth solving --------------------------- */

/** True when an inward offset result is genuinely the shrunken plate. Past
 *  the collapse depth the naive miter offset returns an orientation-flipped
 *  phantom polygon (often partly OUTSIDE the plate) whose |area| grows again
 *  with d — every downstream number still reconciles on such garbage, so it
 *  must be rejected structurally, not by area checks. */
function validInnerOffset(plate: Point[], inner: Point[]): boolean {
  if (inner.length < 3 || polygonArea(inner) < 0.01) return false;
  if (isCounterClockwise(inner) !== isCounterClockwise(plate)) return false;
  return inner.every((p) => pointInPoly(p, plate));
}

/** Largest inward offset that still yields a valid polygon (≈ inradius). */
function maxInwardOffset(plate: Point[]): number {
  let lo = 0;
  let hi = Math.sqrt(polygonArea(plate)); // generous upper bound
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (validInnerOffset(plate, offsetPolygon(plate, mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Solve the inward offset d so the strip area — measured EXACTLY the way the
 *  unit cuts will tile it (full-ring slice through the outer→inner frame) —
 *  matches stripArea. Using the same measure on both sides keeps the drawn
 *  unit areas equal to their targets even when the miter offset drops
 *  vertices on concave plates. */
function solveStripDepth(
  plate: Point[],
  stripArea: number,
): { d: number; inner: Point[]; frame: StripFrame | null; trueArea: number } {
  const dMax = maxInwardOffset(plate);
  const measure = (d: number): { inner: Point[]; frame: StripFrame | null; area: number } => {
    const inner = offsetPolygon(plate, d);
    if (!validInnerOffset(plate, inner)) {
      // Collapsed/phantom offset — the strip has eaten the whole plate.
      return { inner: [], frame: null, area: polygonArea(plate) };
    }
    const frame = makeFrame(plate, ensureCCW(inner));
    return { inner: ensureCCW(inner), frame, area: sliceArea(frame, 0, frame.outerTotal) };
  };
  let lo = 0, hi = dMax;
  for (let i = 0; i < 56; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid).area < stripArea) lo = mid;
    else hi = mid;
  }
  const d = (lo + hi) / 2;
  const m = measure(d);
  return { d, inner: m.inner, frame: m.frame, trueArea: m.area };
}

/* ------------------------------- strip cutting ----------------------------- */

interface StripFrame {
  outer: Point[];
  /** One inner point PER OUTER VERTEX — the strip's inner boundary as the
   *  cuts see it. innerAt() interpolates linearly between these, so any set
   *  of slices tiles the strip exactly (Σ slice areas ≡ full-ring area). */
  innerV: Point[];
  outerLens: number[];
  outerTotal: number;
  innerAt: (t: number) => Point;
}

function nearestOnRing(p: Point, ring: Point[]): Point {
  let best: Point = ring[0];
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const u = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const q = { x: a.x + abx * u, y: a.y + aby * u };
    const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < bestD) { bestD = dd; best = q; }
  }
  return best;
}

/** Build the outer→inner pairing. offsetPolygon returns the ring ROTATED ONE
 *  INDEX forward — its result[i] is the miter corner of input vertex i+1
 *  (each output point is the intersection of offset edges i and i+1) — so
 *  when the vertex counts match, outer vertex k pairs with inner[(k−1+n)%n].
 *  Pairing inner[k] instead slants every cut one edge around the ring: the
 *  seam slice becomes a self-intersecting bowtie and |shoelace| over-counts
 *  the drawn areas by 2× that unit. When the offset dropped vertices we pin
 *  each outer vertex to its nearest point on the inner ring instead. */
function makeFrame(outer: Point[], inner: Point[]): StripFrame {
  const { lens, total } = perimeterLengths(outer);
  const sameStructure = inner.length === outer.length;
  const n = inner.length;
  const innerV = outer.map((p, k) => (sameStructure ? inner[(k + n - 1) % n] : nearestOnRing(p, inner)));
  const innerAt = (t: number): Point => {
    const { edge, frac } = pointAt(outer, lens, t);
    const a = innerV[edge];
    const b = innerV[(edge + 1) % innerV.length];
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  };
  return { outer, innerV, outerLens: lens, outerTotal: total, innerAt };
}

/** Ring of the strip slice between outer arc-lengths t0 → t1 (t1 > t0). */
function slicePolygon(f: StripFrame, t0: number, t1: number): Point[] {
  const pts: Point[] = [];
  // Outer chain: from t0 forward to t1 (may wrap past the ring origin).
  pts.push(pointAt(f.outer, f.outerLens, t0).p);
  const n = f.outer.length;
  // collect outer vertices strictly between t0 and t1
  const verts: { t: number; p: Point }[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += f.outerLens[i];
    const vt = run; // arc-length at vertex (i+1)%n
    verts.push({ t: vt % f.outerTotal, p: f.outer[(i + 1) % n] });
  }
  const span = t1 - t0;
  const between: { t: number; p: Point }[] = [];
  for (const v of verts) {
    let dt = v.t - t0;
    if (dt <= EPS) dt += f.outerTotal;
    if (dt < span - EPS) between.push({ t: dt, p: v.p });
  }
  between.sort((a, b) => a.t - b.t);
  for (const v of between) pts.push(v.p);
  const t1n = t1 >= f.outerTotal ? t1 - f.outerTotal : t1;
  pts.push(pointAt(f.outer, f.outerLens, t1n).p);
  // Inner chain, reversed: t1 back to t0.
  pts.push(f.innerAt(t1n));
  for (let i = between.length - 1; i >= 0; i--) {
    const tAbs = (t0 + between[i].t) % f.outerTotal;
    pts.push(f.innerAt(tAbs));
  }
  pts.push(f.innerAt(t0));
  return pts;
}

/** Area of slicePolygon(t0, t1) — monotone increasing in t1. */
function sliceArea(f: StripFrame, t0: number, t1: number): number {
  return ringArea(slicePolygon(f, t0, t1));
}

/** Outer chain of the slice (facade stretch), for balcony bands. */
function sliceOuterChain(f: StripFrame, t0: number, t1: number): Point[] {
  const t1n = t1 >= f.outerTotal ? t1 - f.outerTotal : t1;
  const pts: Point[] = [pointAt(f.outer, f.outerLens, t0).p];
  const n = f.outer.length;
  const verts: { t: number; p: Point }[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += f.outerLens[i];
    verts.push({ t: run % f.outerTotal, p: f.outer[(i + 1) % n] });
  }
  const span = t1 - t0;
  const between: { t: number; p: Point }[] = [];
  for (const v of verts) {
    let dt = v.t - t0;
    if (dt <= EPS) dt += f.outerTotal;
    if (dt < span - EPS) between.push({ t: dt, p: v.p });
  }
  between.sort((a, b) => a.t - b.t);
  for (const v of between) pts.push(v.p);
  pts.push(pointAt(f.outer, f.outerLens, t1n).p);
  return pts;
}

/** Dashed balcony band: quads pushed outward from the unit's facade chain. */
function balconyBand(chain: Point[], outwardSign: number, depth: number): Point[][] {
  const quads: Point[][] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.3) continue;
    const nx = (dy / len) * outwardSign;
    const ny = (-dx / len) * outwardSign;
    quads.push([
      a, b,
      { x: b.x + nx * depth, y: b.y + ny * depth },
      { x: a.x + nx * depth, y: a.y + ny * depth },
    ]);
  }
  return quads;
}

/* ---------------------------------- core ----------------------------------- */

export interface CoreSpec {
  lifts: number;
  liftW?: number;   // shaft width, m (default 2.0)
  liftD?: number;   // shaft depth, m (default 2.6)
  stairW?: number;  // stair width, m (default 2.7)
  stairD?: number;  // stair depth, m (default 5.2)
  lobbyD?: number;  // lift lobby depth, m (default 2.4)
}

function rot(p: Point, c: Point, ang: number): Point {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}

function rectAt(cx: number, cy: number, w: number, h: number): Point[] {
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Angle of the plate's longest edge — the core aligns with it. */
function dominantAngle(plate: Point[]): number {
  let best = 0, bestLen = -1;
  for (let i = 0; i < plate.length; i++) {
    const a = plate[i], b = plate[(i + 1) % plate.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) { bestLen = len; best = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return best;
}

function buildCore(inner: Point[], spec: CoreSpec, angle: number): { core: CoreLayout; fits: boolean } {
  const liftW = spec.liftW ?? 2.0;
  const liftD = spec.liftD ?? 2.6;
  const stairW = spec.stairW ?? 2.7;
  const stairD = spec.stairD ?? 5.2;
  const lobbyD = spec.lobbyD ?? 2.4;
  const lifts = Math.max(1, Math.round(spec.lifts));

  // Lifts in a row on one side of the lobby; the two stairs on the other.
  const bankW = lifts * liftW;
  const stairsW = stairW * 2 + 1.2; // 1.2 m services slot between stairs
  const coreW = Math.max(bankW, stairsW);
  const coreH = liftD + lobbyD + stairD;

  const c = polygonCentroid(inner);
  const mk = (w: number, h: number, oy: number): Point[] =>
    rectAt(c.x, c.y + oy, w, h).map((p) => rot(p, c, angle));

  const rect = mk(coreW, coreH, 0);
  const lobbyOy = coreH / 2 - liftD - lobbyD / 2;
  const parts: CoreLayout["parts"] = [
    { kind: "lifts", rect: mk(bankW, liftD, coreH / 2 - liftD / 2), label: `LIFTS × ${lifts}` },
    { kind: "lobby", rect: mk(coreW, lobbyD, lobbyOy), label: "LOBBY" },
    {
      kind: "stair",
      rect: rectAt(c.x - (stairsW / 2 - stairW / 2), c.y - coreH / 2 + stairD / 2, stairW, stairD).map((p) => rot(p, c, angle)),
      label: "STAIR 1",
    },
    {
      kind: "stair",
      rect: rectAt(c.x + (stairsW / 2 - stairW / 2), c.y - coreH / 2 + stairD / 2, stairW, stairD).map((p) => rot(p, c, angle)),
      label: "STAIR 2",
    },
  ];
  const fits = rect.every((p) => pointInPoly(p, inner));
  return {
    core: { rect, parts, areaM2: coreW * coreH, angle },
    fits,
  };
}

/* --------------------------------- main ------------------------------------ */

export function computeFloorPlan(
  platePoly: Point[],
  unitsIn: UnitSpec[],
  coreSpec: CoreSpec,
): FloorPlanResult {
  const warnings: string[] = [];
  const plate = ensureCCW(platePoly.filter(Boolean));
  if (plate.length < 3) {
    return {
      plate, plateArea: 0, inner: [], stripDepth: 0, units: [], unitsTargetArea: 0,
      unitsAchievedArea: 0, core: null, circulationArea: 0,
      warnings: ["No tower footprint — set the tower polygon or setbacks first."],
    };
  }
  const plateArea = polygonArea(plate);
  const units = unitsIn.filter((u) => u.area > 0);
  const unitsTargetArea = units.reduce((s, u) => s + u.area, 0);

  if (units.length === 0) {
    return {
      plate, plateArea, inner: [], stripDepth: 0, units: [], unitsTargetArea: 0,
      unitsAchievedArea: 0, core: null, circulationArea: plateArea,
      warnings: ["No units on this floor — fill the Apartments matrix first."],
    };
  }

  // Reserve at least the core + a sane corridor before letting the unit strip
  // swallow the plate. If the programme doesn't fit, scale the strip down and
  // say so rather than failing.
  const coreProbe = buildCore(plate, coreSpec, 0).core; // just for the area
  const minInnerArea = coreProbe.areaM2 * 1.9; // core + wrap-around corridor
  let stripTarget = unitsTargetArea;
  if (plateArea - stripTarget < minInnerArea) {
    stripTarget = Math.max(plateArea * 0.35, plateArea - minInnerArea);
    warnings.push(
      `This floor's programme (${Math.round(unitsTargetArea)} m²) plus the core does not fit the ` +
      `${Math.round(plateArea)} m² plate — units are drawn compressed (${Math.round(stripTarget)} m² strip). ` +
      `Reduce units on this floor or enlarge the tower footprint.`,
    );
  }

  const { d, inner, frame, trueArea } = solveStripDepth(plate, stripTarget);
  if (inner.length < 3 || !frame) {
    return {
      plate, plateArea, inner: [], stripDepth: d, units: [], unitsTargetArea,
      unitsAchievedArea: 0, core: null, circulationArea: 0,
      warnings: [...warnings, "Could not carve a unit strip on this plate (footprint too thin)."],
    };
  }
  if (d < 5)  warnings.push(`Unit strip is only ${d.toFixed(1)} m deep — very shallow units; check the programme.`);
  if (d > 14) warnings.push(`Unit strip is ${d.toFixed(1)} m deep — units this deep will struggle for daylight.`);

  // Scale unit targets onto the strip area as the cuts will actually measure
  // it — ≈1 when the programme fits, <1 when compressed.
  const scale = trueArea / Math.max(1e-6, unitsTargetArea);

  // Cut positions: walk the perimeter, bisect each cut so every unit hits its
  // (possibly scaled) share of the strip.
  const placed: PlacedUnit[] = [];
  const outwardSign = 1; // plate is CCW ⇒ outward normal of an edge (dx,dy) is (dy,-dx)
  let t0 = 0;
  let accArea = 0;
  for (let i = 0; i < units.length; i++) {
    const target = units[i].area * scale;
    let t1: number;
    if (i === units.length - 1) {
      t1 = frame.outerTotal; // last unit closes the ring
    } else {
      let lo = t0 + 0.05, hi = frame.outerTotal - (units.length - 1 - i) * 0.1;
      for (let k = 0; k < 44; k++) {
        const mid = (lo + hi) / 2;
        if (sliceArea(frame, t0, mid) < target) lo = mid;
        else hi = mid;
      }
      t1 = (lo + hi) / 2;
    }
    const polygon = slicePolygon(frame, t0, t1);
    const areaAchieved = ringArea(polygon);
    const outerChain = sliceOuterChain(frame, t0, t1);
    const balconyDepth = units[i].balcony > 0
      ? Math.min(2.4, Math.max(0.9, units[i].balcony / Math.max(
          1,
          outerChain.reduce((s, p, j) => j === 0 ? 0 : s + Math.hypot(p.x - outerChain[j - 1].x, p.y - outerChain[j - 1].y), 0),
        )))
      : 0;
    placed.push({
      spec: units[i],
      polygon,
      areaAchieved,
      outerChain,
      balconyQuads: balconyDepth > 0 ? balconyBand(outerChain, outwardSign, balconyDepth) : [],
    });
    accArea += areaAchieved;
    t0 = t1;
  }

  // Core inside the inner zone (the ring the units actually meet).
  const innerRing = frame.innerV;
  const angle = dominantAngle(plate);
  const { core, fits } = buildCore(innerRing, coreSpec, angle);
  if (!fits) {
    warnings.push(
      "The communication core does not fully fit the circulation zone — the plate is tight for " +
      "this lift/stair count. Treat the core position as indicative.",
    );
  }
  // Self-consistent remainder: whatever the drawn units and the core don't
  // occupy is corridor/lobby space.
  const circulationArea = Math.max(0, plateArea - accArea - core.areaM2);

  return {
    plate,
    plateArea,
    inner: innerRing,
    stripDepth: d,
    units: placed,
    unitsTargetArea,
    unitsAchievedArea: accArea,
    core,
    circulationArea,
    warnings,
  };
}
