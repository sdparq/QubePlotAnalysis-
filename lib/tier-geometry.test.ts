import { describe, expect, it } from "vitest";
import { resolveTiers, tierOrigin, wouldLoop } from "./tier-geometry";
import { polygonArea } from "./geom";
import { emptyProject } from "./sample";
import type { Project } from "./types";

const SQ = (x0: number, y0: number, s: number) => [
  { x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s },
];

/** 60 × 60 m plot centred on the origin; setbacks ground 3 / podium 3 / tower 6. */
function base(): Project {
  const p = emptyProject("Tiers");
  p.plotMode = "polygon";
  p.plotPolygon = SQ(-30, -30, 60);
  p.groundSetbackM = 3;
  p.podiumSetbackM = 3;
  p.towerSetbackM = 6;
  return p;
}
const area = (polys: { x: number; y: number }[][]) => polys.reduce((s, poly) => s + polygonArea(poly), 0);

describe("tier geometry", () => {
  it("without a stored mode: setbacks, or the traced blocks when there are any", () => {
    const p = base();
    let t = resolveTiers(p);
    expect(t.ground.mode).toBe("setbacks");
    expect(area(t.ground.polygons)).toBeCloseTo(54 * 54, 3);
    expect(area(t.tower.polygons)).toBeCloseTo(48 * 48, 3);
    p.towerPolygons = [SQ(-10, -10, 20)];
    t = resolveTiers(p);
    expect(t.tower.mode).toBe("traced");
    expect(area(t.tower.polygons)).toBeCloseTo(400, 3);
  });

  it("'same as ground' follows the ground — traced or from setbacks — live", () => {
    const p = base();
    p.tierMode = { podium: "ground" };
    expect(area(resolveTiers(p).podium.polygons)).toBeCloseTo(54 * 54, 3);
    p.groundSetbackM = 5; // the ground changes → the podium follows
    expect(area(resolveTiers(p).podium.polygons)).toBeCloseTo(50 * 50, 3);
    p.groundPolygons = [SQ(-20, -20, 30), SQ(12, 12, 10)];
    const t = resolveTiers(p);
    expect(t.podium.origin).toBe("ground");
    expect(t.podium.source).toBe("traced");
    expect(t.podium.polygons).toHaveLength(2);
    expect(area(t.podium.polygons)).toBeCloseTo(1000, 3);
  });

  it("chains: tower = podium = ground", () => {
    const p = base();
    p.tierMode = { podium: "ground", tower: "podium" };
    expect(tierOrigin(p, "tower")).toBe("ground");
    expect(area(resolveTiers(p).tower.polygons)).toBeCloseTo(54 * 54, 3);
  });

  it("'setbacks' ignores traced blocks without deleting them", () => {
    const p = base();
    p.podiumPolygons = [SQ(-10, -10, 20)];
    p.tierMode = { podium: "setbacks" };
    expect(area(resolveTiers(p).podium.polygons)).toBeCloseTo(54 * 54, 3);
    expect(p.podiumPolygons).toHaveLength(1);
    p.tierMode = { podium: "traced" };
    expect(area(resolveTiers(p).podium.polygons)).toBeCloseTo(400, 3);
  });

  it("uses per-edge setbacks when they match the plot", () => {
    const p = base();
    p.towerSetbackPerEdge = [10, 0, 0, 0]; // only the first edge (y = −30) moves in
    expect(area(resolveTiers(p).tower.polygons)).toBeCloseTo(60 * 50, 3);
  });

  it("never loops: a closed chain falls back to the tier's own geometry", () => {
    const p = base();
    p.tierMode = { ground: "tower", tower: "ground" };
    const t = resolveTiers(p);
    expect(area(t.ground.polygons)).toBeCloseTo(54 * 54, 3);
    expect(area(t.tower.polygons)).toBeCloseTo(48 * 48, 3);
    p.tierMode = { podium: "ground" };
    expect(wouldLoop(p, "ground", "podium")).toBe(true);
    expect(wouldLoop(p, "tower", "podium")).toBe(false);
  });

  it("the tower offset moves the tower and whoever copies it, not the others", () => {
    const p = base();
    p.towerOffsetXM = 4;
    p.tierMode = { podium: "tower" };
    const t = resolveTiers(p);
    const minX = (polys: { x: number }[][]) => Math.min(...polys.flat().map((q) => q.x));
    expect(minX(t.tower.polygons)).toBeCloseTo(-24 + 4, 3);
    expect(minX(t.podium.polygons)).toBeCloseTo(-24 + 4, 3);
    expect(minX(t.ground.polygons)).toBeCloseTo(-27, 3);
  });
});
