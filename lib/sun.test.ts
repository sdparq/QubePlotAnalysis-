import { describe, expect, it } from "vitest";
import { dubaiDaylight, dubaiSun, formatClock, sunDirectionWorld } from "./sun";

/** Highest altitude of the day and where it happens (1-minute scan). */
function noon(y: number, m: number, d: number) {
  let best = { h: 0, alt: -90, az: 0 };
  for (let h = 10; h <= 14; h += 1 / 60) {
    const s = dubaiSun(y, m, d, h);
    if (s.altitudeDeg > best.alt) best = { h, alt: s.altitudeDeg, az: s.azimuthDeg };
  }
  return best;
}

describe("Dubai sun position", () => {
  it("equinox noon: altitude ≈ 90° − latitude, due south, ~12:25 local", () => {
    const n = noon(2026, 3, 20);
    expect(n.alt).toBeGreaterThan(64);
    expect(n.alt).toBeLessThan(65.8);
    expect(Math.abs(n.az - 180)).toBeLessThan(2);
    expect(n.h).toBeGreaterThan(12.25);
    expect(n.h).toBeLessThan(12.6);
  });

  it("solstices bracket the noon altitude", () => {
    expect(noon(2026, 6, 21).alt).toBeGreaterThan(87.5);
    const dec = noon(2026, 12, 21).alt;
    expect(dec).toBeGreaterThan(40.8);
    expect(dec).toBeLessThan(42);
  });

  it("rises in the east and sets in the west at the equinox", () => {
    const { sunrise, sunset } = dubaiDaylight(2026, 3, 20);
    expect(Math.abs(dubaiSun(2026, 3, 20, sunrise).azimuthDeg - 90)).toBeLessThan(3);
    expect(Math.abs(dubaiSun(2026, 3, 20, sunset).azimuthDeg - 270)).toBeLessThan(3);
  });

  it("matches published Dubai sunrise / sunset within a few minutes", () => {
    const jun = dubaiDaylight(2026, 6, 21);
    expect(Math.abs(jun.sunrise - (5 + 29 / 60))).toBeLessThan(6 / 60);
    expect(Math.abs(jun.sunset - (19 + 13 / 60))).toBeLessThan(6 / 60);
    const dec = dubaiDaylight(2026, 12, 21);
    expect(Math.abs(dec.sunrise - (7 + 1 / 60))).toBeLessThan(6 / 60);
    expect(Math.abs(dec.sunset - (17 + 34 / 60))).toBeLessThan(6 / 60);
  });
});

describe("sunDirectionWorld", () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  it("maps compass bearings onto the viewer frame (north = −z)", () => {
    close(sunDirectionWorld({ azimuthDeg: 90, altitudeDeg: 0 }), [1, 0, 0]);
    close(sunDirectionWorld({ azimuthDeg: 180, altitudeDeg: 0 }), [0, 0, 1]);
    close(sunDirectionWorld({ azimuthDeg: 0, altitudeDeg: 90 }), [0, 1, 0]);
  });
  it("rotates with the drawing's north bearing", () => {
    // True north drawn along +x: a sun due north lies along +x.
    close(sunDirectionWorld({ azimuthDeg: 0, altitudeDeg: 0 }, 90), [1, 0, 0]);
  });
});

describe("formatClock", () => {
  it("formats decimal hours", () => {
    expect(formatClock(6.5)).toBe("06:30");
    expect(formatClock(17.999)).toBe("18:00");
  });
});
