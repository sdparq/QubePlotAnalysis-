import { describe, it, expect } from "vitest";
import { computeTowerYield } from "./tower-yield";
import { emptyProject } from "../sample";

function baseProject() {
  const p = emptyProject("Test");
  p.targetGFA = 10000;
  p.gfaBreakdown = { residential: { mode: "absolute", value: 8000 } };
  // Apartments at 100% so apartmentsGFA === residentialGFA and the round
  // numbers below stay round. The apartments-share semantic has its own test.
  p.residentialBreakdown = {
    apartments: { pct: 100, countsAsGFA: true },
    amenities: { pct: 0, countsAsGFA: true },
    circulation: { pct: 0, countsAsGFA: true },
    services: { pct: 0, countsAsGFA: true },
  };
  return p;
}

describe("computeTowerYield", () => {
  it("returns zeros when no footprints are entered", () => {
    const r = computeTowerYield(baseProject());
    expect(r.requiredTowerFloors).toBe(0);
    expect(r.towerFloors).toBe(0);
    expect(r.exceedsMax).toBe(false);
  });

  it("derives tower floors from apartments GFA ÷ tower footprint", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    const r = computeTowerYield(p);
    expect(r.apartmentsGFA).toBe(8000);
    expect(r.requiredTowerFloors).toBe(16); // 8000 / 500
    expect(r.towerFloors).toBe(16);
    expect(r.towerGFA).toBe(8000);
    expect(r.exceedsMax).toBe(false);
  });

  it("sizes the tower from the APARTMENTS quota, not the full residential GFA", () => {
    const p = baseProject();
    p.towerFootprintM2 = 500;
    // Apartments = 100 − 10 − 10 = 80% → 6,400 m² of the 8,000 residential.
    p.residentialBreakdown = {
      apartments: { pct: 80, countsAsGFA: true },
      amenities: { pct: 10, countsAsGFA: true },
      circulation: { pct: 10, countsAsGFA: true },
      services: { pct: 10, countsAsGFA: true },
    };
    const r = computeTowerYield(p);
    expect(r.apartmentsGFA).toBeCloseTo(6400, 5);
    expect(r.requiredTowerFloors).toBe(12); // floor(6400 / 500) = 12
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
