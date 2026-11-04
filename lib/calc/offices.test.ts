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
