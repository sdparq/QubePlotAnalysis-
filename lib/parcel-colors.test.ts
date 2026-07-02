import { describe, it, expect } from "vitest";
import { isYellowishFill, isReddishStroke, parcelColorScore, rgbToHsv, type RGB } from "./parcel-colors";

const DLD_ORANGE: RGB = [240, 168, 96];   // typical affection-plan parcel fill
const PALE_YELLOW: RGB = [255, 243, 176];
const RED: RGB = [229, 57, 53];
const DARK_RED: RGB = [180, 30, 30];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [200, 200, 200];
const BLACK: RGB = [0, 0, 0];
const BLUE: RGB = [50, 80, 220];
const GREEN: RGB = [60, 180, 90];

describe("rgbToHsv", () => {
  it("computes hue for primaries", () => {
    expect(rgbToHsv([255, 0, 0]).h).toBeCloseTo(0, 1);
    expect(rgbToHsv([0, 255, 0]).h).toBeCloseTo(120, 1);
    expect(rgbToHsv([0, 0, 255]).h).toBeCloseTo(240, 1);
  });
  it("handles achromatic colours", () => {
    expect(rgbToHsv(WHITE).s).toBe(0);
    expect(rgbToHsv(BLACK).v).toBe(0);
  });
});

describe("isYellowishFill", () => {
  it("accepts the DLD orange parcel fill", () => {
    expect(isYellowishFill(DLD_ORANGE)).toBe(true);
  });
  it("accepts pale yellow highlights", () => {
    expect(isYellowishFill(PALE_YELLOW)).toBe(true);
  });
  it("rejects white, grey, red, blue and green", () => {
    expect(isYellowishFill(WHITE)).toBe(false);
    expect(isYellowishFill(GREY)).toBe(false);
    expect(isYellowishFill(RED)).toBe(false);
    expect(isYellowishFill(BLUE)).toBe(false);
    expect(isYellowishFill(GREEN)).toBe(false);
  });
});

describe("isReddishStroke", () => {
  it("accepts typical boundary reds", () => {
    expect(isReddishStroke(RED)).toBe(true);
    expect(isReddishStroke(DARK_RED)).toBe(true);
  });
  it("rejects black, grey and the yellow fill itself", () => {
    expect(isReddishStroke(BLACK)).toBe(false);
    expect(isReddishStroke(GREY)).toBe(false);
    expect(isReddishStroke(DLD_ORANGE)).toBe(false);
  });
});

describe("parcelColorScore", () => {
  it("scores the full DLD combo highest", () => {
    expect(parcelColorScore(DLD_ORANGE, RED)).toBe(3);
  });
  it("yellow fill alone crosses the parcel threshold (≥2)", () => {
    expect(parcelColorScore(DLD_ORANGE, BLACK)).toBe(2);
    expect(parcelColorScore(DLD_ORANGE, null)).toBe(2);
  });
  it("red stroke alone (e.g. certification stamp) stays below threshold", () => {
    expect(parcelColorScore(null, RED)).toBe(1);
    expect(parcelColorScore(WHITE, RED)).toBe(1);
  });
  it("neutral shapes score zero", () => {
    expect(parcelColorScore(WHITE, BLACK)).toBe(0);
    expect(parcelColorScore(null, null)).toBe(0);
  });
});
