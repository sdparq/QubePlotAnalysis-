import { describe, expect, it } from "vitest";
import { facadeGrid, filletPolygon, roofLayout } from "./facade-geometry";
import { resolveFacade } from "./facade";
import { polygonArea, polygonCentroid, polygonPerimeter, rectanglePlotPolygon, type Point } from "./geom";

const rect = rectanglePlotPolygon(30, 20);
/** An L-shaped plate with one re-entrant corner at (10, 10). */
const ell: Point[] = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];

function inside(p: Point, poly: Point[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

describe("filletPolygon", () => {
  it("rounds every corner of a rectangle and trims only the corners", () => {
    const r = filletPolygon(rect, 4);
    expect(r.length).toBeGreaterThan(rect.length * 4);
    // Exact arcs remove (1 − π/4)·r² per corner; the chords remove a little more.
    const lost = polygonArea(rect) - polygonArea(r);
    expect(lost).toBeGreaterThan(4 * (1 - Math.PI / 4) * 16 - 0.01);
    expect(lost).toBeLessThan(16);
    const b = { minX: Math.min(...rect.map((p) => p.x)), maxX: Math.max(...rect.map((p) => p.x)) };
    for (const p of r) {
      expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-9);
    }
  });

  it("keeps re-entrant corners sharp", () => {
    const r = filletPolygon(ell, 3);
    expect(r.some((p) => Math.hypot(p.x - 10, p.y - 10) < 1e-9)).toBe(true);
  });

  it("shrinks the radius on short edges instead of overlapping arcs", () => {
    const thin = rectanglePlotPolygon(4, 40);
    const r = filletPolygon(thin, 6);
    expect(polygonArea(r)).toBeGreaterThan(0.8 * polygonArea(thin));
  });
});

describe("facadeGrid", () => {
  it("puts a station on every corner of a sharp outline and tiles its whole perimeter", () => {
    const g = facadeGrid(rect, 1.5);
    expect(g.stations.filter((s) => s.corner)).toHaveLength(4);
    const tiled = g.panels.reduce((sum, p) => sum + p.len, 0);
    expect(tiled).toBeCloseTo(polygonPerimeter(rect), 6);
    for (const p of g.panels) expect(p.len).toBeLessThan(2.3);
  });

  it("points every normal outward, whatever the winding", () => {
    for (const poly of [rect, rect.slice().reverse(), filletPolygon(rect, 5)]) {
      const c = polygonCentroid(poly);
      for (const s of facadeGrid(poly, 1.6).stations) {
        expect(Math.hypot(s.nx, s.ny)).toBeCloseTo(1, 6);
        expect((s.x - c.x) * s.nx + (s.y - c.y) * s.ny).toBeGreaterThan(0);
        expect(inside({ x: s.x + s.nx * 0.05, y: s.y + s.ny * 0.05 }, poly)).toBe(false);
      }
    }
  });

  it("wraps modules smoothly round rounded corners", () => {
    const g = facadeGrid(filletPolygon(rect, 5), 1.6);
    expect(g.stations.some((s) => s.corner)).toBe(false);
    const lens = g.panels.map((p) => p.len);
    expect(Math.max(...lens) / Math.min(...lens)).toBeLessThan(1.1);
  });

  it("handles a concave plate", () => {
    const g = facadeGrid(ell, 1.8);
    expect(g.stations.filter((s) => s.corner)).toHaveLength(6);
    for (const s of g.stations) expect(inside({ x: s.x + s.nx * 0.05, y: s.y + s.ny * 0.05 }, ell)).toBe(false);
  });
});

describe("roofLayout", () => {
  it("fits a sky pool and a pavilion inside a tower roof", () => {
    const plate = filletPolygon(rectanglePlotPolygon(40, 26), 4);
    const { pool, core } = roofLayout(plate);
    expect(pool).not.toBeNull();
    expect(core).not.toBeNull();
    for (const r of [pool!, core!]) {
      for (const a of [-0.5, 0.5]) {
        for (const b of [-0.5, 0.5]) {
          const p = { x: r.x + r.ux * a * r.len + r.vx * b * r.wid, y: r.y + r.uy * a * r.len + r.vy * b * r.wid };
          expect(inside(p, plate)).toBe(true);
        }
      }
    }
  });

  it("skips the pool on a roof too small for one", () => {
    expect(roofLayout(rectanglePlotPolygon(9, 9)).pool).toBeNull();
  });
});

describe("resolveFacade", () => {
  it("defaults to a designed tower with balconies, crown and entrance", () => {
    const f = resolveFacade(undefined);
    expect(f).toMatchObject({ mode: "residential", style: "balconies", crown: true, entrance: true, roundedCorners: true });
  });

  it("keeps a project's own choices", () => {
    expect(resolveFacade({ mode: "massing", style: "fins", glass: "bronze" })).toMatchObject({
      mode: "massing",
      style: "fins",
      glass: "bronze",
      accent: "champagne",
    });
  });
});
