import { describe, it, expect } from "vitest";
import { computeTowerYield } from "./tower-yield";
import { emptyProject } from "../sample";

function baseProject() {
  const p = emptyProject("Test");
  p.targetGFA = 10000;
  p.gfaBreakdown = { residential: { mode: "absolute", value: 8000 } };
  return p;
}

describe("computeTowerYield", () => {
  it("returns zeros when no footprints are entered", () => {
    const r = computeTowerYield(baseProject());
    expect(r.requiredTowerFloors).toBe(0);
    expect(r.towerFloors).toBe(0);
    expect(r.exceedsMax).toBe(false);
  });

  it("derives tower floors from (residential − ground) ÷ tower footprint", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    const r = computeTowerYield(p);
    expect(r.towerTargetGFA).toBe(8000); // no ground plate set
    expect(r.requiredTowerFloors).toBe(16); // 8000 / 500
    expect(r.towerFloors).toBe(16);
    expect(r.towerGFA).toBe(8000);
    expect(r.exceedsMax).toBe(false);
  });

  it("subtracts the ground-floor surface from the residential GFA", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    p.groundFootprintM2 = 1000;
    p.ground = { count: 1, heightM: 4.5 };
    const r = computeTowerYield(p);
    expect(r.towerTargetGFA).toBe(7000); // 8000 − 1×1000
    expect(r.requiredTowerFloors).toBe(14); // floor(7000 / 500)
  });

  it("never goes negative when the ground floor exceeds the residential GFA", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    p.groundFootprintM2 = 9000;
    p.ground = { count: 1, heightM: 4.5 };
    const r = computeTowerYield(p);
    expect(r.towerTargetGFA).toBe(0);
    expect(r.requiredTowerFloors).toBe(0);
  });

  it("floors (doesn't round up) partial floors", () => {
    const p = baseProject();
    p.towerFootprintM2 = 600; // 8000/600 = 13.33
    const r = computeTowerYield(p);
    expect(r.requiredTowerFloors).toBe(13);
  });

  it("multiplies ground/podium footprint by their floor counts from Setup", () => {
    const p = baseProject();
    p.groundFootprintM2 = 1000;
    p.podiumFootprintM2 = 900;
    p.ground = { count: 1, heightM: 4.5 };
    p.podium = { count: 3, heightM: 4.0 };
    const r = computeTowerYield(p);
    expect(r.groundGFA).toBe(1000);
    expect(r.podiumGFA).toBe(2700);
  });

  it("defaults ground count to 1 and podium count to 0 when unset", () => {
    const p = baseProject();
    p.groundFootprintM2 = 800;
    p.podiumFootprintM2 = 800;
    const r = computeTowerYield(p);
    expect(r.groundCount).toBe(1);
    expect(r.groundGFA).toBe(800);
    expect(r.podiumCount).toBe(0);
    expect(r.podiumGFA).toBe(0);
  });

  it("clamps tower floors to the zoning cap when the GFA needs more", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500; // needs 16 floors
    p.maxTowerFloors = 10;
    const r = computeTowerYield(p);
    expect(r.requiredTowerFloors).toBe(16);
    expect(r.towerFloors).toBe(10);
    expect(r.towerGFA).toBe(5000);
    expect(r.exceedsMax).toBe(true);
    expect(r.floorsShort).toBe(6);
    expect(r.gfaShort).toBe(3000);
  });

  it("does not clamp when the cap is generous enough", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500; // needs 16 floors
    p.maxTowerFloors = 20;
    const r = computeTowerYield(p);
    expect(r.towerFloors).toBe(16);
    expect(r.exceedsMax).toBe(false);
    expect(r.floorsShort).toBe(0);
  });

  it("ignores a zero or negative cap as 'no cap'", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    p.maxTowerFloors = 0;
    const r = computeTowerYield(p);
    expect(r.maxTowerFloors).toBeNull();
    expect(r.towerFloors).toBe(16);
  });

  it("treats negative manual footprints as zero", () => {
    const p = baseProject();
    p.towerFootprintM2 = -100;
    const r = computeTowerYield(p);
    expect(r.towerFootprintM2).toBe(0);
    expect(r.requiredTowerFloors).toBe(0);
  });
});
