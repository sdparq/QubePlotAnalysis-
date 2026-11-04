import { describe, expect, it } from "vitest";
import { computeOffices, DEFAULT_OFFICE_BREAKDOWN } from "./offices";
import { computeParking } from "./parking";
import { computeAreas } from "./areas";
import { emptyProject } from "../sample";
import type { Project } from "../types";

/** Mixed scheme: 20,000 m² residential + 10,000 m² offices (JVC-style). */
function mixed(): Project {
  const p = emptyProject("JVC Offices");
  p.targetGFA = 30000;
  p.gfaBreakdown = {
    residential: { mode: "absolute", value: 20000 },
    commercial: { mode: "absolute", value: 10000 },
  };
  p.typologies = [];
  p.program = [];
  return p;
}

describe("offices", () => {
  it("splits the office GFA into circulation, services and net lettable offices", () => {
    const p = mixed();
    p.officeBreakdown = { circulationPct: 15, servicesPct: 5 };
    const o = computeOffices(p);
    expect(o.officeGFA).toBe(10000);
    expect(o.circulation).toBeCloseTo(1500, 5);
    expect(o.services).toBeCloseTo(500, 5);
    expect(o.netPct).toBe(80);
    expect(o.net).toBeCloseTo(8000, 5);
  });

  it("uses sensible defaults and also reads a % of Target GFA", () => {
    const p = mixed();
    p.gfaBreakdown!.commercial = { mode: "percent", value: 20 }; // 20 % × 30,000
    const o = computeOffices(p);
    expect(o.officeGFA).toBeCloseTo(6000, 5);
    const net = 100 - DEFAULT_OFFICE_BREAKDOWN.circulationPct - DEFAULT_OFFICE_BREAKDOWN.servicesPct;
    expect(o.net).toBeCloseTo(6000 * net / 100, 5);
  });

  it("requires 1 parking space per 50 m² of office GSA (editable), on top of the rest", () => {
    const p = mixed();
    p.officeBreakdown = { circulationPct: 15, servicesPct: 5 }; // GSA 8,000
    const r = computeParking(p);
    expect(r.officeGSA).toBeCloseTo(8000, 5);
    expect(r.officeRequired).toBe(160); // 8,000 / 50
    expect(r.grandRequired).toBe(160); // no units, no retail
    p.officeM2PerSpace = 40;
    expect(computeParking(p).officeRequired).toBe(200);
  });

  it("feeds the GSA total but leaves GFA and BUA whole", () => {
    const p = mixed();
    p.officeBreakdown = { circulationPct: 15, servicesPct: 5 };
    const a = computeAreas(p);
    expect(a.totalGFA).toBeCloseTo(30000, 5);
    expect(a.officeNet).toBeCloseTo(8000, 5);
    // GSA = residential (quota, empty matrix) + offices net
    expect(a.gsaTotal).toBeCloseTo(a.gsaResidential + 8000, 5);
    // Office circulation + services stay inside the office GFA → BUA counts all 10,000.
    expect(a.constructionBUA).toBeGreaterThanOrEqual(10000);
  });

  it("is zero without an office use", () => {
    const p = mixed();
    delete p.gfaBreakdown!.commercial;
    const o = computeOffices(p);
    expect(o.net).toBe(0);
    expect(o.parkingRequired).toBe(0);
  });
});

import { computeOfficeStack, towerTotals } from "./offices";
import { computeTowerYield } from "./tower-yield";

/** JVC-style stack: 3 podium levels of 1,200 m², a 1,000 m² tower plate. */
function stacked(): Project {
  const p = mixed(); // 20,000 residential + 10,000 offices
  p.podium = { count: 3, heightM: 4 };
  p.ground = { count: 1, heightM: 5 };
  p.groundFootprintM2 = 0;
  p.podiumFootprintM2 = 1200;
  p.towerFootprintM2 = 1000;
  p.typeFloors = { count: 18, heightM: 3.2 };
  p.numFloors = 18;
  return p;
}

describe("office stacking", () => {
  it("puts what the podium levels don't hold into tower floors, rounded up", () => {
    const p = stacked();
    p.officeStack = { podiumLevels: [2, 3] }; // 2 × 1,200 = 2,400
    const s = computeOfficeStack(p);
    expect(s.podiumGFA).toBe(2400);
    expect(s.remainingGFA).toBe(7600);
    expect(s.autoTowerFloors).toBe(8); // 7,600 / 1,000 → 8
    expect(s.towerFloors).toBe(8);
    expect(s.placementDrift).toBe(400); // 2,400 + 8,000 − 10,000
  });

  it("honours a manual office floor count and drops podium levels that don't exist", () => {
    const p = stacked();
    p.officeStack = { podiumLevels: [3, 7], towerFloors: 5, towerPosition: "top", heightM: 4.2 };
    const s = computeOfficeStack(p);
    expect(s.podiumLevels).toEqual([3]);
    expect(s.towerFloors).toBe(5);
    expect(s.manualTowerFloors).toBe(true);
    expect(s.towerPosition).toBe("top");
  });

  it("office podium levels stop being taken off the residential GFA", () => {
    const p = stacked();
    expect(computeTowerYield(p).towerTargetGFA).toBe(20000 - 3 * 1200);
    p.officeStack = { podiumLevels: [2, 3] };
    expect(computeTowerYield(p).towerTargetGFA).toBe(20000 - 1 * 1200);
  });

  it("adds the office floors to the tower height but not to the Apartments floors", () => {
    const p = stacked();
    p.officeStack = { towerFloors: 6, heightM: 4 };
    const t = towerTotals(p);
    expect(t.residentialFloors).toBe(18);
    expect(t.officeFloors).toBe(6);
    expect(t.floors).toBe(24);
    expect(t.heightM).toBeCloseTo(18 * 3.2 + 6 * 4, 5);
    expect(p.numFloors).toBe(18);
  });

  it("asks for the tower footprint when it can't derive the floors", () => {
    const p = stacked();
    p.towerFootprintM2 = 0;
    const s = computeOfficeStack(p);
    expect(s.towerFloors).toBe(0);
    expect(s.needsTowerFootprint).toBe(true);
  });
});
