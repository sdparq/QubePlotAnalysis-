import { describe, expect, it } from "vitest";
import { footprintsPatch, plotFootprints, tierFloors, unmodelledTiers } from "./tier-status";
import { emptyProject } from "./sample";
import type { Project } from "./types";

/** New offices + retail project with the plot traced: 60 × 60 m. */
function fresh(): Project {
  const p = emptyProject("Al Jadaf Offices");
  p.plotMode = "polygon";
  p.plotPolygon = [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }];
  p.targetGFA = 14000;
  p.gfaBreakdown = { commercial: { mode: "absolute", value: 12000 }, retail: { mode: "absolute", value: 2000 } };
  p.numFloors = 0;
  p.typeFloors = { count: 0, heightM: 3.6 };
  p.tierMode = { podium: "ground" };
  p.towerSetbackM = 10;
  return p;
}

describe("tier status", () => {
  it("explains why the podium and the tower are not modelled, with a fix", () => {
    const p = fresh();
    const issues = unmodelledTiers(p);
    expect(issues.map((i) => i.tier)).toEqual(["podium", "tower"]);
    // Applying both fixes models every tier.
    const fixed = { ...p, ...issues[0].fix!.patch, ...issues[1].fix!.patch } as Project;
    expect(unmodelledTiers(fixed)).toEqual([]);
    const f = tierFloors(fixed);
    expect(f.podium).toBe(1);
    expect(f.towerOffice).toBe(Math.ceil(12000 / 1600)); // 40 × 40 m plate → 8 floors
  });

  it("does not flag a podium nobody asked for", () => {
    const p = fresh();
    p.tierMode = undefined;
    expect(unmodelledTiers(p).map((i) => i.tier)).toEqual(["tower"]);
  });

  it("copies Plot's footprints into Distribution's figures", () => {
    const p = fresh();
    expect(plotFootprints(p)).toEqual({ ground: 54 * 54, podium: 54 * 54, tower: 40 * 40 });
    expect(footprintsPatch(p)).toEqual({ groundFootprintM2: 2916, podiumFootprintM2: 2916, towerFootprintM2: 1600 });
  });

  it("says so when the tower simply has no use", () => {
    const p = fresh();
    p.gfaBreakdown = { retail: { mode: "absolute", value: 2000 } };
    const tower = unmodelledTiers(p).find((i) => i.tier === "tower")!;
    expect(tower.fix).toBeUndefined();
    expect(tower.reason).toMatch(/no residential or office GFA/);
  });
});
