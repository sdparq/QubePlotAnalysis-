import { describe, expect, it } from "vitest";
import { computeFloorPlan, type UnitSpec } from "./floor-plan";
import { polygonArea, type Point } from "./geom";

const rect = (w: number, h: number): Point[] => [
  { x: -w / 2, y: -h / 2 },
  { x: w / 2, y: -h / 2 },
  { x: w / 2, y: h / 2 },
  { x: -w / 2, y: h / 2 },
];

const u = (id: string, area: number, balcony = 0): UnitSpec => ({
  id, label: id, category: "1BR", area, balcony,
});

const CORE = { lifts: 3 };

describe("computeFloorPlan", () => {
  it("solves the strip so unit areas hit their targets on a rectangular plate", () => {
    const plate = rect(48, 30); // 1440 m²
    const units = [u("a", 220), u("b", 180), u("c", 260), u("d", 150), u("e", 190)]; // 1000 m²
    const plan = computeFloorPlan(plate, units, CORE);

    expect(plan.warnings).toEqual([]);
    expect(plan.plateArea).toBeCloseTo(1440, 0);
    // Strip area == Σ units within solver tolerance
    const stripArea = plan.plateArea - polygonArea(plan.inner);
    expect(Math.abs(stripArea - 1000)).toBeLessThan(2);
    // Every unit within 2% of its target
    for (let i = 0; i < units.length; i++) {
      expect(Math.abs(plan.units[i].areaAchieved - units[i].area) / units[i].area).toBeLessThan(0.02);
    }
    // Achieved total ≈ strip area (the cuts tile the strip completely)
    expect(Math.abs(plan.unitsAchievedArea - stripArea)).toBeLessThan(2);
  });

  it("keeps the core inside the circulation zone on a healthy plate", () => {
    const plate = rect(48, 30);
    const units = [u("a", 200), u("b", 200), u("c", 200), u("d", 200)];
    const plan = computeFloorPlan(plate, units, { lifts: 4 });
    expect(plan.core).not.toBeNull();
    expect(plan.warnings.join(" ")).not.toMatch(/does not fully fit/);
    // Core parts: one lift bank, one lobby, two stairs
    const kinds = plan.core!.parts.map((p) => p.kind).sort();
    expect(kinds).toEqual(["lifts", "lobby", "stair", "stair"]);
    expect(plan.circulationArea).toBeGreaterThan(0);
  });

  it("works on an irregular (pentagon) plate", () => {
    const plate: Point[] = [
      { x: -25, y: -14 }, { x: 24, y: -17 }, { x: 30, y: 10 }, { x: 0, y: 22 }, { x: -27, y: 12 },
    ];
    const A = polygonArea(plate);
    const units = [u("a", A * 0.2), u("b", A * 0.25), u("c", A * 0.18)]; // 63% of plate
    const plan = computeFloorPlan(plate, units, CORE);
    for (let i = 0; i < units.length; i++) {
      expect(Math.abs(plan.units[i].areaAchieved - units[i].area) / units[i].area).toBeLessThan(0.03);
    }
    // Polygons are real rings
    for (const pu of plan.units) expect(pu.polygon.length).toBeGreaterThanOrEqual(4);
  });

  it("warns and compresses when the programme exceeds the plate", () => {
    const plate = rect(30, 20); // 600 m²
    const units = [u("a", 400), u("b", 350)]; // 750 m² > plate
    const plan = computeFloorPlan(plate, units, CORE);
    expect(plan.warnings.join(" ")).toMatch(/does not fit/);
    // Still draws every unit
    expect(plan.units).toHaveLength(2);
    const stripArea = plan.plateArea - polygonArea(plan.inner);
    expect(stripArea).toBeLessThan(plan.plateArea);
    // Compressed proportionally: unit a bigger than unit b
    expect(plan.units[0].areaAchieved).toBeGreaterThan(plan.units[1].areaAchieved);
  });

  it("tiles exactly: Σ drawn areas equals the units target, no seam over-count", () => {
    // Regression: offsetPolygon returns its ring rotated one index — a
    // misaligned outer→inner pairing turned the seam slice into a bowtie and
    // |shoelace| over-counted the total by 2× that unit's area.
    const plate = rect(68, 72.55); // the sample project's real tower plate
    const units = [u("3br", 133.4), ...Array.from({ length: 22 }, (_, i) => u(`s${i}`, 31)), u("1br", 60), u("2br", 90)];
    const target = units.reduce((s, x) => s + x.area, 0);
    const plan = computeFloorPlan(plate, units, { lifts: 3 });
    expect(Math.abs(plan.unitsAchievedArea - target) / target).toBeLessThan(0.005);
    // No bowties: every unit ring must carry the same signed orientation.
    const signed = (pts: { x: number; y: number }[]) => {
      let s = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        s += a.x * b.y - b.x * a.y;
      }
      return s / 2;
    };
    const signs = plan.units.map((pu) => Math.sign(signed(pu.polygon)));
    expect(new Set(signs).size).toBe(1);
  });

  it("rejects the phantom inverted offset past the collapse depth (concave L)", () => {
    // Regression: past ~12.5 m the miter offset of this L-plate flips
    // orientation and wanders outside the plate; the solver used to converge
    // there (stripDepth ≈ 31.9 m) with every number reconciling on garbage.
    const plate: Point[] = [
      { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 35, y: 40 }, { x: 35, y: 25 }, { x: 0, y: 25 },
    ];
    const units = Array.from({ length: 8 }, (_, i) => u(`x${i}`, 180)); // 1440 of 1875 m²
    const plan = computeFloorPlan(plate, units, { lifts: 3 });
    expect(plan.stripDepth).toBeLessThan(12.6);
    for (const p of plan.inner) {
      expect(p.x).toBeGreaterThanOrEqual(-0.01);
      expect(p.x).toBeLessThanOrEqual(60.01);
      expect(p.y).toBeGreaterThanOrEqual(-0.01);
      expect(p.y).toBeLessThanOrEqual(40.01);
    }
  });

  it("returns a friendly message with no units", () => {
    const plan = computeFloorPlan(rect(30, 20), [], CORE);
    expect(plan.units).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/Apartments matrix/);
  });

  it("adds dashed balcony bands only for units with balcony area", () => {
    const plate = rect(48, 30);
    const units = [u("a", 300, 24), u("b", 300, 0)];
    const plan = computeFloorPlan(plate, units, CORE);
    expect(plan.units[0].balconyQuads.length).toBeGreaterThan(0);
    expect(plan.units[1].balconyQuads).toEqual([]);
    // Balcony quads sit OUTSIDE the plate (centroid farther than facade midpoint)
    const quad = plan.units[0].balconyQuads[0];
    const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
    const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
    const inPlate = (() => {
      let inside = false;
      for (let i = 0, j = plate.length - 1; i < plate.length; j = i++) {
        const xi = plate[i].x, yi = plate[i].y, xj = plate[j].x, yj = plate[j].y;
        if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    })();
    expect(inPlate).toBe(false);
  });
});
