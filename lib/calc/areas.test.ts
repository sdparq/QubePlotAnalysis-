import { describe, expect, it } from "vitest";
import { computeAreas } from "./areas";
import { computeParking } from "./parking";
import { emptyProject } from "../sample";
import type { Project } from "../types";

/** Residential 15,000 (89% apartments = 13,350) + retail 2,000, no balconies
 *  (empty Apartments matrix) — keeps the arithmetic checkable by hand. */
function baseProject(): Project {
  const p = emptyProject("Areas test");
  p.targetGFA = 20000;
  p.gfaBreakdown = {
    residential: { mode: "absolute", value: 15000 },
    retail: { mode: "absolute", value: 2000 },
  };
  p.plotArea = 3000;
  p.ground = { count: 1, heightM: 4.5 };
  p.podium = { count: 2, heightM: 4 };
  p.basements = { count: 2, heightM: 3.2 };
  p.typologies = [];
  p.program = [];
  return p;
}

describe("computeAreas", () => {
  it("splits the residential GFA per the Distribution percentages", () => {
    const r = computeAreas(baseProject());
    expect(r.residentialGFA).toBe(15000);
    expect(r.apartmentsPct).toBeCloseTo(89, 5); // 100 − 1 amenities − 10 circulation
    expect(r.apartmentsInterior).toBeCloseTo(13350, 5);
    expect(r.amenities).toBeCloseTo(150, 5);
    expect(r.circulation).toBeCloseTo(1500, 5);
    expect(r.services).toBeCloseTo(1500, 5);
  });

  it("counts retail in the sellable GSA but not commercial", () => {
    const p = baseProject();
    p.gfaBreakdown!.commercial = { mode: "absolute", value: 1000 };
    const r = computeAreas(p);
    expect(r.gsaResidential).toBeCloseTo(13350, 5);
    expect(r.gsaTotal).toBeCloseTo(15350, 5); // + retail 2,000
    expect(r.totalGFA).toBeCloseTo(18000, 5); // 15,000 + 2,000 + 1,000
  });

  it("BUA = residential sellable + retail + amenities + circulation + services + ground/podium parking + basements", () => {
    const p = baseProject();
    p.basementFootprintM2 = 2000; // 2 levels × 2,000 = 4,000 m²
    p.groundParkingM2 = 600;
    p.podiumParkingPerFloorM2 = 900; // × 2 podium levels = 1,800
    const r = computeAreas(p);

    expect(r.groundPodiumParking).toBeCloseTo(2400, 5); // 600 + 1,800
    expect(r.basementSurface).toBeCloseTo(4000, 5);

    const expected =
      13350 + 0 /* balconies */ + 2000 /* retail */ + 150 + 1500 + 1500 + 2400 + r.basementsNet;
    expect(r.constructionBUA).toBeCloseTo(expected, 5);
  });

  it("trims surplus parking surface off the basements", () => {
    const p = baseProject();
    p.basementFootprintM2 = 2000;
    p.groundParkingM2 = 0;
    p.podiumParkingPerFloorM2 = 0;
    // No units placed → no residential demand; retail 2,000 m² ÷ 70 = 29 spaces
    // (+ POD) × 25 m²/space ⇒ a small requirement against 4,000 m² of basement.
    const r = computeAreas(p);
    const required = computeParking(p).totalParkingSurfaceM2;
    expect(r.parkingRequiredSurface).toBeCloseTo(required, 5);
    expect(r.parkingSurplus).toBeCloseTo(4000 - required, 5);
    expect(r.basementsNet).toBeCloseTo(required, 5); // exactly what is needed
    expect(r.basementsNet).toBeLessThan(r.basementSurface);
  });

  it("keeps the whole basement when parking is short (no surplus)", () => {
    const p = baseProject();
    p.basementFootprintM2 = 200; // 2 × 200 = 400 m², far below the requirement
    const r = computeAreas(p);
    expect(r.parkingSurplus).toBe(0);
    expect(r.basementsNet).toBeCloseTo(400, 5);
  });

  it("never books negative basement area when ground/podium alone over-provide", () => {
    const p = baseProject();
    p.basementFootprintM2 = 500; // 1,000 m²
    p.groundParkingM2 = 50000;   // absurd over-provision
    const r = computeAreas(p);
    expect(r.basementsNet).toBe(0);
    expect(r.constructionBUA).toBeGreaterThan(0);
  });

  it("adds balconies from the Apartments matrix to the residential sellable", () => {
    const p = baseProject();
    p.typologies = [
      { id: "t1", name: "2BR", category: "2BR", internalArea: 100, balconyArea: 20, occupancy: 3, parkingPerUnit: 1 },
    ];
    p.numFloors = 2;
    p.program = [
      { floor: 1, typologyId: "t1", count: 5 },
      { floor: 2, typologyId: "t1", count: 5 },
    ];
    const r = computeAreas(p);
    expect(r.balconyShare).toBeCloseTo(0.2, 5); // 200 balcony ÷ 1,000 interior
    expect(r.balconies).toBeCloseTo(13350 * 0.2, 5);
    expect(r.gsaResidential).toBeCloseTo(13350 * 1.2, 5);
  });
});
