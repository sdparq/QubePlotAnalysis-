import { describe, it, expect } from "vitest";
import { PRODUCTION_CITY_SAMPLE } from "../sample";
import { analyze } from "./index";

describe("Production City — parity vs Excel", () => {
  const r = analyze(PRODUCTION_CITY_SAMPLE);

  it("program totals match Excel", () => {
    expect(r.program.totalUnits).toBe(346);
    expect(r.program.totalInteriorGFA).toBeCloseTo(17754.73, 1);
    expect(r.program.totalBalcony).toBeCloseTo(4754, 0);
    expect(r.program.totalSellable).toBeCloseTo(22508.73, 1);
    expect(r.program.shaftsDeduction).toBe(173);
    expect(r.program.commonAreasGFA).toBeCloseTo(3832.43, 1);
    expect(r.program.totalGFABuilding).toBeCloseTo(21414.16, 1);
  });

  it("parking totals match Excel", () => {
    expect(r.parking.availableStandard).toBe(360);
    expect(r.parking.availablePOD).toBe(9);
    expect(r.parking.availableTotal).toBe(369);
    const studio1br2br = r.parking.requiredByCategory
      .filter((x) => ["Studio", "1BR", "2BR"].includes(x.category))
      .reduce((s, x) => s + x.required, 0);
    const br3 = r.parking.requiredByCategory.find((x) => x.category === "3BR");
    expect(studio1br2br).toBe(338);
    expect(br3?.required).toBe(16);
    expect(r.parking.requiredTotal).toBe(354);
    expect(r.parking.requiredPOD).toBe(8);
    expect(r.parking.grandRequiredWithPOD).toBe(r.parking.grandRequired + r.parking.requiredPOD);
    expect(r.parking.balance).toBe(15);
  });

  it("lifts (Dubai Building Code D.8.8) compute population", () => {
    expect(r.lifts.totalPopulation).toBeCloseTo(682.5, 1);
    expect(r.lifts.occupiedFloors).toBe(8);
    expect(r.lifts.liftsRecommended).toBeGreaterThanOrEqual(0);
    expect(r.lifts.governing).toMatch(/D\.8\.8|VT Consultant/);
  });
});
