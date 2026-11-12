import { describe, expect, it } from "vitest";
import { computeOfficeStack, towerParking } from "./offices";
import { computeTowerYield } from "./tower-yield";
import { computeAreas } from "./areas";
import { emptyProject } from "../sample";
import type { Project } from "../types";

/** Residential tower: 20,000 m² on a 1,000 m² plate, no base plates. */
function residential(): Project {
  const p = emptyProject("Tower parking");
  p.plotArea = 3000;
  p.targetGFA = 20000;
  p.gfaBreakdown = { residential: { mode: "absolute", value: 20000 } };
  p.towerFootprintM2 = 1000;
  p.basements = { count: 2, heightM: 3.2 };
  return p;
}

describe("parking on tower floors", () => {
  it("is nothing until both the surface and the floors are set", () => {
    const p = residential();
    expect(towerParking(p).surface).toBe(0);
    p.towerParkingPerFloorM2 = 400;
    expect(towerParking(p).surface).toBe(0);
    p.towerParkingFloors = 3;
    expect(towerParking(p)).toMatchObject({ perFloorM2: 400, floors: 3, surface: 1200, host: "residential" });
  });

  it("takes plate area from the apartments, so the same GFA needs more floors", () => {
    const p = residential();
    expect(computeTowerYield(p).towerFloors).toBe(20);
    p.towerParkingPerFloorM2 = 500;
    p.towerParkingFloors = 4; // 2,000 m² of parking = 2 more plates
    const y = computeTowerYield(p);
    expect(y.towerParkingM2).toBe(2000);
    expect(y.towerFloors).toBe(22);
    expect(y.towerGFA).toBe(20000); // 22 × 1,000 − 2,000
  });

  it("sits on the office floors when they are at the bottom of the tower", () => {
    const p = residential();
    p.gfaBreakdown = { residential: { mode: "absolute", value: 12000 }, commercial: { mode: "absolute", value: 8000 } };
    p.towerParkingPerFloorM2 = 500;
    p.towerParkingFloors = 2; // 1,000 m²
    expect(towerParking(p).host).toBe("office");
    const s = computeOfficeStack(p);
    expect(s.towerFloors).toBe(9); // (8,000 + 1,000) / 1,000
    expect(s.towerGFA).toBe(8000);
    expect(computeTowerYield(p).towerFloors).toBe(12); // apartments unaffected
    // Offices on top → the apartments host it instead.
    p.officeStack = { towerPosition: "top" };
    expect(towerParking(p).host).toBe("residential");
    expect(computeOfficeStack(p).towerFloors).toBe(8);
    expect(computeTowerYield(p).towerFloors).toBe(13);
  });

  it("counts as parking supply and as built area", () => {
    const p = residential();
    const before = computeAreas(p);
    p.towerParkingPerFloorM2 = 500;
    p.towerParkingFloors = 4;
    const after = computeAreas(p);
    expect(after.towerParking).toBe(2000);
    // No units placed → no parking demand: the whole supply is surplus, so the
    // basements drop out of the BUA and the tower parking stays in it.
    expect(after.parkingSurplus).toBe(before.parkingSurplus + 2000);
    expect(after.constructionBUA).toBeCloseTo(before.constructionBUA + 2000, 5);
  });
});
