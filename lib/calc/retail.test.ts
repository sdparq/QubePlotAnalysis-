import { describe, expect, it } from "vitest";
import { computeRetail } from "./retail";
import { computeAreas } from "./areas";
import { computeParking } from "./parking";
import { computeOfficeStack, towerTotals } from "./offices";
import { activeUnits, desiredResidentialFloors, isNonResidential } from "./scheme";
import { emptyProject } from "../sample";
import type { Project } from "../types";

/** Al Jadaf-style scheme: offices over ground-floor retail, no residential. */
function officesOverRetail(): Project {
  const p = emptyProject("Al Jadaf Offices");
  p.targetGFA = 14000;
  p.gfaBreakdown = {
    commercial: { mode: "absolute", value: 12000 },
    retail: { mode: "absolute", value: 2000 },
  };
  p.ground = { count: 1, heightM: 5 };
  p.groundFootprintM2 = 2400;
  p.towerFootprintM2 = 1500;
  p.officeBreakdown = { circulationPct: 15, servicesPct: 5 };
  return p;
}

describe("retail distribution", () => {
  it("sells the whole retail GFA until a split is entered", () => {
    const r = computeRetail(officesOverRetail());
    expect(r.retailGFA).toBe(2000);
    expect(r.netPct).toBe(100);
    expect(r.net).toBe(2000);
  });

  it("takes circulation and services off the retail GSA", () => {
    const p = officesOverRetail();
    p.retailBreakdown = { circulationPct: 10, servicesPct: 8 };
    const r = computeRetail(p);
    expect(r.circulation).toBeCloseTo(200, 5);
    expect(r.services).toBeCloseTo(160, 5);
    expect(r.net).toBeCloseTo(1640, 5);
    const a = computeAreas(p);
    expect(a.retailNet).toBeCloseTo(1640, 5);
    // GSA = offices net 9,600 + retail net 1,640; GFA and BUA keep the whole retail.
    expect(a.gsaTotal).toBeCloseTo(9600 + 1640, 5);
    expect(a.totalGFA).toBeCloseTo(14000, 5);
    expect(a.constructionBUA).toBeGreaterThanOrEqual(14000);
  });

  it("parks retail on its GFA by default, or on its GSA when asked", () => {
    const p = officesOverRetail();
    p.retailBreakdown = { circulationPct: 10, servicesPct: 8 };
    expect(computeParking(p).retailRequired).toBe(Math.ceil(2000 / 70)); // 29
    p.retailParkingBasis = "gsa";
    const r = computeParking(p);
    expect(r.retailBasis).toBe("gsa");
    expect(r.retailRequired).toBe(Math.ceil(1640 / 70)); // 24
    // Offices: 9,600 m² GSA / 50 = 192; total standard = 192 + 24.
    expect(r.officeRequired).toBe(192);
    expect(r.grandRequired).toBe(216);
  });
});

describe("schemes without residential", () => {
  it("is recognised and asks for zero residential tower floors", () => {
    const p = officesOverRetail();
    expect(isNonResidential(p)).toBe(true);
    expect(desiredResidentialFloors(p)).toBe(0);
    p.numFloors = 0;
    p.typeFloors = { count: 0, heightM: 3.6 };
    expect(desiredResidentialFloors(p)).toBeNull(); // already there
  });

  it("builds the tower out of office floors only", () => {
    const p = officesOverRetail();
    p.numFloors = 0;
    p.typeFloors = { count: 0, heightM: 3.6 };
    const s = computeOfficeStack(p);
    expect(s.towerFloors).toBe(8); // 12,000 / 1,500
    const t = towerTotals(p);
    expect(t.residentialFloors).toBe(0);
    expect(t.floors).toBe(8);
    expect(t.heightM).toBeCloseTo(8 * 4, 5);
  });

  it("never drops a matrix that still holds units", () => {
    const p = officesOverRetail();
    p.numFloors = 3;
    p.typologies = [{ id: "t1", name: "1BR", category: "1BR", internalArea: 60, balconyArea: 8, occupancy: 1.8, parkingPerUnit: 1 }];
    p.program = [{ floor: 1, typologyId: "t1", count: 4 }, { floor: 9, typologyId: "t1", count: 4 }];
    expect(activeUnits(p)).toBe(4); // the floor-9 cell is outside the 3 floors
    expect(desiredResidentialFloors(p)).toBeNull();
  });

  it("gives residential its floors back when it returns", () => {
    const p = officesOverRetail();
    p.numFloors = 0;
    p.typeFloors = { count: 0, heightM: 3.6 };
    p.gfaBreakdown!.residential = { mode: "absolute", value: 9000 };
    // 9,000 − ground 2,400 = 6,600 / 1,500 → 4 floors
    expect(desiredResidentialFloors(p)).toBe(4);
    p.towerFootprintM2 = 0;
    expect(desiredResidentialFloors(p)).toBe(1); // no plate yet: at least one floor to fill
  });

  it("leaves residential-only projects without a GFA target alone", () => {
    const p = emptyProject("Hand-filled");
    p.numFloors = 8;
    expect(isNonResidential(p)).toBe(false);
    expect(desiredResidentialFloors(p)).toBeNull();
  });
});
