import { describe, expect, it } from "vitest";
import { balconyGfaFactor, unitGfaArea } from "./balcony";
import { computeProgramAutoFill } from "./program-autofill";
import { computeProgram } from "./program";
import { computeAreas } from "./areas";
import { residentialSubBUA } from "./gfa";
import { emptyProject } from "../sample";
import type { Project } from "../types";
import type { TypologyKey } from "../zone-classes";

const NO_CLASS_MIX: Record<TypologyKey, number> = {
  studio: 0, "1BR": 0, "2BR": 0, "3BR": 0, "4BR": 0, "5BR": 0, "6BR": 0, "7BR": 0, penthouse: 0,
};

/** Residential 15,000 → apartments 89 % = 13,350 m². One 2BR typology of
 *  100 m² interior + 20 m² balcony carrying 100 % of the unit mix, so the
 *  unit count is apartments GFA ÷ GFA-per-unit, checkable by hand. */
function project(balconyGfaPct?: 0 | 50 | 100): Project {
  const p = emptyProject("Balcony GFA test");
  p.targetGFA = 20000;
  p.gfaBreakdown = { residential: { mode: "absolute", value: 15000 } };
  p.plotArea = 3000;
  p.numFloors = 10;
  p.typologies = [
    { id: "t2", name: "2BR", category: "2BR", internalArea: 100, balconyArea: 20, occupancy: 3, parkingPerUnit: 1 },
  ];
  p.typologyMixById = { t2: 100 };
  p.program = [];
  p.balconyGfaPct = balconyGfaPct;
  return p;
}

describe("balconies in GFA", () => {
  it("defaults to GFA-exempt balconies (today's behaviour)", () => {
    const p = project();
    expect(balconyGfaFactor(p)).toBe(0);
    expect(unitGfaArea(p, p.typologies[0])).toBe(100);
  });

  it("GFA per unit = interior + counted share of the balcony", () => {
    expect(unitGfaArea(project(50), project().typologies[0])).toBe(110);
    expect(unitGfaArea(project(100), project().typologies[0])).toBe(120);
  });

  it("the auto-fill sizes units on GFA per unit, so counting balconies places fewer units", () => {
    const at = (pct: 0 | 50 | 100) => computeProgramAutoFill(project(pct), NO_CLASS_MIX)!;
    expect(at(0).totalUnits).toBe(Math.round(13350 / 100)); // 134
    expect(at(50).totalUnits).toBe(Math.round(13350 / 110)); // 121
    expect(at(100).totalUnits).toBe(Math.round(13350 / 120)); // 111
    // allocatedGFA reports the GFA those units consume, not just interiors.
    expect(at(50).perTypology[0].allocatedGFA).toBeCloseTo(121 * 110, 5);
  });

  it("the matrix reports the GFA it consumes next to the physical areas", () => {
    const p = project(50);
    p.program = computeProgramAutoFill(p, NO_CLASS_MIX)!.cells;
    const r = computeProgram(p);
    expect(r.totalUnits).toBe(121);
    expect(r.totalInteriorGFA).toBeCloseTo(12100, 5);
    expect(r.totalBalcony).toBeCloseTo(2420, 5);
    expect(r.totalBalconyGFA).toBeCloseTo(1210, 5);
    expect(r.totalApartmentsGFA).toBeCloseTo(13310, 5); // interior + ½ balconies ≈ target
    expect(r.totalSellable).toBeCloseTo(14520, 5); // interior + WHOLE balcony
    expect(r.efficiency.balconiesNonGFA).toBeCloseTo(1210, 5);
    expect(r.byFloor.reduce((s, f) => s + f.totalGFA, 0)).toBeCloseTo(13310, 5);
    expect(r.byTypology[0].totalGFA).toBeCloseTo(13310, 5);
  });

  it("Areas Summary compares GFA consumed against the Apartments GFA target", () => {
    const p = project(50);
    p.program = computeProgramAutoFill(p, NO_CLASS_MIX)!.cells;
    const a = computeAreas(p);
    expect(a.usesMatrix).toBe(true);
    expect(a.balconyGfaFactor).toBe(0.5);
    expect(a.apartmentsGFA).toBeCloseTo(13310, 5);
    expect(a.balconiesGFA).toBeCloseTo(1210, 5);
    expect(a.apartmentsDrift).toBeCloseTo(13310 - 13350, 5); // −40 m², within 1 %
    // Sellable still takes the whole balcony.
    expect(a.gsaResidential).toBeCloseTo(14520, 5);
  });

  it("GSA and BUA are physical — the same matrix yields the same figures under any rule", () => {
    const cells = computeProgramAutoFill(project(50), NO_CLASS_MIX)!.cells;
    const under = (pct: 0 | 50 | 100) => {
      const p = project(pct);
      p.program = cells;
      return computeAreas(p);
    };
    const a0 = under(0), a50 = under(50), a100 = under(100);
    expect(a0.gsaResidential).toBeCloseTo(a50.gsaResidential, 5);
    expect(a0.gsaResidential).toBeCloseTo(a100.gsaResidential, 5);
    expect(a0.constructionBUA).toBeCloseTo(a50.constructionBUA, 5);
    expect(a0.constructionBUA).toBeCloseTo(a100.constructionBUA, 5);
    // …while the GFA consumed climbs with the rule.
    expect(a0.apartmentsGFA).toBeLessThan(a50.apartmentsGFA);
    expect(a50.apartmentsGFA).toBeLessThan(a100.apartmentsGFA);
  });

  it("apartments BUA scales the quota by sellable ÷ GFA consumed", () => {
    const p = project(50);
    p.program = computeProgramAutoFill(p, NO_CLASS_MIX)!.cells;
    // quota 13,350 × (14,520 / 13,310)
    expect(residentialSubBUA(p, "apartments")).toBeCloseTo(13350 * (14520 / 13310), 5);
  });
});
