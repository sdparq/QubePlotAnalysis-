import { describe, expect, it } from "vitest";
import {
  assembleRings,
  bboxAround,
  overpassFailure,
  buildingHeights,
  fromLocal,
  isInUae,
  localToPlan,
  overpassQuery,
  parseLatLng,
  parseLength,
  parseOverpass,
  planToLocal,
  toLocal,
  withoutPlot,
  type LatLng,
} from "./site-context";
import { polygonCentroid, rectanglePlotPolygon, type Point } from "./geom";

const BB: LatLng = { lat: 25.1865, lng: 55.264 };

describe("parseLatLng", () => {
  it("reads decimal pairs as copied from Google Maps", () => {
    expect(parseLatLng("25.1865, 55.2640")).toEqual({ lat: 25.1865, lng: 55.264 });
    expect(parseLatLng(" 25.1865 55.2640 ")).toEqual({ lat: 25.1865, lng: 55.264 });
    expect(parseLatLng("25.1865° N, 55.2640° E")).toEqual({ lat: 25.1865, lng: 55.264 });
  });

  it("reads degrees, minutes and seconds", () => {
    const p = parseLatLng(`25°11'11.4"N 55°15'50.4"E`)!;
    expect(p.lat).toBeCloseTo(25.1865, 4);
    expect(p.lng).toBeCloseTo(55.264, 4);
  });

  it("prefers the dropped pin of a Google Maps link over the map centre", () => {
    const url =
      "https://www.google.com/maps/place/Business+Bay/@25.1800,55.2600,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.1865!4d55.264!16s";
    expect(parseLatLng(url)).toEqual({ lat: 25.1865, lng: 55.264 });
    expect(parseLatLng("https://www.google.com/maps/@25.1801,55.2602,17z")).toEqual({ lat: 25.1801, lng: 55.2602 });
    expect(parseLatLng("https://maps.google.com/?q=25.1865,55.264")).toEqual({ lat: 25.1865, lng: 55.264 });
  });

  it("rejects text that is not a location", () => {
    expect(parseLatLng("")).toBeNull();
    expect(parseLatLng("Business Bay")).toBeNull();
    expect(parseLatLng("125.5, 255.1")).toBeNull();
  });

  it("flags coordinates outside the UAE", () => {
    expect(isInUae(BB)).toBe(true);
    expect(isInUae({ lat: 55.264, lng: 25.1865 })).toBe(false);
  });
});

describe("local and plan frames", () => {
  it("measures metres around the location", () => {
    const p = toLocal(BB, { lat: BB.lat + 0.001, lon: BB.lng + 0.001 });
    expect(p.y).toBeCloseTo(110.78, 1);
    expect(p.x).toBeCloseTo(100.78, 1);
    const back = fromLocal(BB, p);
    expect(back.lat).toBeCloseTo(BB.lat + 0.001, 9);
    expect(back.lng).toBeCloseTo(BB.lng + 0.001, 9);
  });

  it("turns plan into local by true north, around the plot centroid", () => {
    const c: Point = { x: 5, y: -3 };
    // North-up drawing: plan and local agree.
    expect(planToLocal({ x: 15, y: -3 }, c, 0)).toEqual({ x: 10, y: 0 });
    // True north 90° clockwise from the drawing's up: up in the drawing is west.
    const up = planToLocal({ x: 5, y: 7 }, c, 90);
    expect(up.x).toBeCloseTo(-10, 9);
    expect(up.y).toBeCloseTo(0, 9);
    const north = localToPlan({ x: 0, y: 10 }, c, 90);
    expect(north.x).toBeCloseTo(15, 9);
    expect(north.y).toBeCloseTo(-3, 9);
    for (const deg of [-137, -20, 0, 33, 180]) {
      const q = localToPlan(planToLocal({ x: 12.5, y: 40 }, c, deg), c, deg);
      expect(q.x).toBeCloseTo(12.5, 9);
      expect(q.y).toBeCloseTo(40, 9);
    }
  });
});

describe("heights", () => {
  it("reads lengths in metres or feet", () => {
    expect(parseLength("45")).toBe(45);
    expect(parseLength("45.5 m")).toBe(45.5);
    expect(parseLength("100 ft")).toBeCloseTo(30.48, 6);
    expect(parseLength("tall")).toBeNull();
  });

  it("uses height, then levels, then a default", () => {
    expect(buildingHeights({ building: "yes", height: "120" })).toEqual({ base: 0, top: 120, estimated: false });
    expect(buildingHeights({ building: "apartments", "building:levels": "10" }).top).toBeCloseTo(33, 6);
    expect(buildingHeights({ building: "villa" })).toMatchObject({ top: 7, estimated: true });
    expect(buildingHeights({ "building:part": "yes", height: "80", min_height: "60" })).toMatchObject({ base: 60, top: 80 });
  });
});

describe("assembleRings", () => {
  it("joins ways end to end, reversing as needed", () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const b = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }]; // runs the other way
    const rings = assembleRings([a, b]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });
});

/* ---- a small Overpass response around Business Bay ---- */

const ll = (x: number, y: number) => {
  const g = fromLocal(BB, { x, y });
  return { lat: g.lat, lon: g.lng };
};
const square = (cx: number, cy: number, r: number) => [
  ll(cx - r, cy - r),
  ll(cx + r, cy - r),
  ll(cx + r, cy + r),
  ll(cx - r, cy + r),
  ll(cx - r, cy - r),
];

const FIXTURE = {
  elements: [
    // A tower next door, with a height.
    { type: "way", id: 1, tags: { building: "yes", height: "150" }, geometry: square(80, 0, 15) },
    // A building standing on the plot — it gives way to the scheme.
    { type: "way", id: 2, tags: { building: "yes", "building:levels": "4" }, geometry: square(0, 0, 10) },
    // An outline split into two parts: only the parts are drawn.
    { type: "way", id: 3, tags: { building: "yes", height: "300" }, geometry: square(-120, 0, 30) },
    { type: "way", id: 4, tags: { "building:part": "yes", height: "300" }, geometry: square(-120, 0, 12) },
    { type: "way", id: 5, tags: { "building:part": "yes", height: "40" }, geometry: square(-100, 20, 8) },
    // A courtyard block as a multipolygon made of two outer ways.
    {
      type: "relation",
      id: 6,
      tags: { type: "multipolygon", building: "apartments" },
      members: [
        { type: "way", role: "outer", geometry: [ll(0, 100), ll(40, 100), ll(40, 140)] },
        { type: "way", role: "outer", geometry: [ll(0, 100), ll(0, 140), ll(40, 140)] },
        { type: "way", role: "inner", geometry: square(20, 120, 8) },
      ],
    },
    // Streets and the canal.
    { type: "way", id: 7, tags: { highway: "primary" }, geometry: [ll(-300, -60), ll(300, -60)] },
    { type: "way", id: 8, tags: { highway: "footway" }, geometry: [ll(-300, -50), ll(300, -50)] },
    { type: "way", id: 9, tags: { highway: "residential", tunnel: "yes" }, geometry: [ll(-10, -300), ll(-10, 300)] },
    { type: "way", id: 10, tags: { natural: "water", water: "canal" }, geometry: [ll(-400, -200), ll(400, -200), ll(400, -150), ll(-400, -150), ll(-400, -200)] },
    { type: "node", id: 11, tags: { amenity: "cafe" } },
  ],
};

describe("parseOverpass", () => {
  const ctx = parseOverpass(FIXTURE, BB);

  it("keeps buildings with their heights and courtyards", () => {
    const tops = ctx.buildings.map((b) => Math.round(b.top)).sort((a, b) => a - b);
    // on-plot 4 levels (13), courtyard block (15, estimated), 2 parts (40, 300), tower (150)
    expect(tops).toEqual([13, 15, 40, 150, 300]);
    const court = ctx.buildings.find((b) => b.holes.length === 1)!;
    expect(court.estimated).toBe(true);
    const c = polygonCentroid(court.outer);
    expect(c.x).toBeCloseTo(20, 1);
    expect(c.y).toBeCloseTo(120, 1);
  });

  it("keeps drivable streets only and the water", () => {
    expect(ctx.roads).toHaveLength(1);
    expect(ctx.roads[0].width).toBe(15);
    expect(ctx.water).toHaveLength(1);
  });

  it("clears the plot of existing buildings", () => {
    const plot = rectanglePlotPolygon(64, 50).map((p) => planToLocal(p, { x: 0, y: 0 }, 0));
    const left = withoutPlot(ctx, plot);
    expect(left.buildings).toHaveLength(ctx.buildings.length - 1);
    expect(left.buildings.some((b) => Math.round(b.top) === 13)).toBe(false);
  });

  it("survives an empty or broken response", () => {
    expect(parseOverpass(null, BB)).toEqual({ buildings: [], roads: [], water: [] });
    expect(parseOverpass({ elements: [{ type: "way", id: 1, tags: { building: "yes" } }] }, BB).buildings).toEqual([]);
  });
});

describe("overpassQuery", () => {
  it("asks for buildings, streets and water in a box around the plot", () => {
    const q = overpassQuery(BB, 400);
    const box = bboxAround(BB, 400);
    expect(box.north - box.south).toBeCloseTo(800 / 110776, 5);
    expect(q).toContain(`[bbox:${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}]`);
    expect(q).toContain('way["building"];');
    expect(q).toContain("out geom");
    expect(q).toContain("primary");
  });

  it("treats timed-out answers as failures", () => {
    expect(overpassFailure({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 61 seconds.' })).toMatch(/timed out/);
    expect(overpassFailure({ elements: [] })).toBeNull();
    expect(overpassFailure("<html>")).not.toBeNull();
  });
});
