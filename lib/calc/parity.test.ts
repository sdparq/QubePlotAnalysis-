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
    expect(r.parking.availablePRM).toBe(9);
    expect(r.parking.availableTotal).toBe(369);
    const studio1br2br = r.parking.requiredByCategory
      .filter((x) => ["Studio", "1BR", "2BR"].includes(x.category))
      .reduce((s, x) => s + x.required, 0);
    const br3 = r.parking.requiredByCategory.find((x) => x.category === "3BR");
    expect(studio1br2br).toBe(338);
    expect(br3?.required).toBe(16);
    expect(r.parking.requiredTotal).toBe(354);
    expect(r.parking.requiredPRM).toBe(8);
    expect(r.parking.balance).toBe(15);
  });

  it("lifts (CIBSE Guide D) match Excel", () => {
    expect(r.lifts.totalPopulation).toBeCloseTo(682.5, 1);
    expect(r.lifts.demandStandard).toBe(35);
    expect(r.lifts.demandPremium).toBe(48);
    expect(r.lifts.personsPerTrip).toBe(13);
    expect(r.lifts.totalTravelHeight).toBeCloseTo(28.8, 1);
    expect(r.lifts.probableStops).toBeCloseTo(2.8, 1);
    expect(r.lifts.rttSeconds).toBeCloseTo(55.3, 1);
    expect(r.lifts.tripsPer5Min).toBeCloseTo(5.4, 1);
    expect(r.lifts.capacityPerLift).toBe(70);
    expect(r.lifts.liftsCIBSE).toBe(1);
    expect(r.lifts.ruleOfThumbLifts).toBe(5);
    expect(r.lifts.dcdMinLifts).toBe(3);
    expect(r.lifts.liftsRecommended).toBe(5);
  });

  it("garbage room (Dubai DM) matches Excel", () => {
    expect(r.garbage.dailyWasteKg).toBeCloseTo(2130.57, 2);
    expect(r.garbage.storageKg).toBeCloseTo(4261.14, 2);
    expect(r.garbage.volumeRequiredM3).toBeCloseTo(28.41, 2);
    expect(r.garbage.containers).toBe(12);
    expect(r.garbage.roomWidthM).toBeCloseTo(18.39, 2);
    expect(r.garbage.roomDepthM).toBeCloseTo(2.64, 2);
    expect(r.garbage.roomAreaM2).toBeCloseTo(48.55, 2);
  });
});
