/** Colour heuristics for auto-detecting the subject parcel in a Dubai DLD
 *  affection plan: the parcel is filled yellow/orange with a red boundary,
 *  while neighbours stay white/grey. Pure module so it's unit-testable. */

export type RGB = [number, number, number];

/** RGB 0–255 → HSV with h in degrees 0–360, s/v in 0–1. */
export function rgbToHsv([r, g, b]: RGB): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Yellow/orange highlight fill (DLD paints the subject parcel #F0A860-ish;
 *  paler yellows also count). White, grey and red all fail. */
export function isYellowishFill(rgb: RGB): boolean {
  const { h, s, v } = rgbToHsv(rgb);
  return h >= 20 && h <= 70 && s >= 0.25 && v >= 0.55;
}

/** Red boundary stroke. */
export function isReddishStroke(rgb: RGB): boolean {
  const { h, s, v } = rgbToHsv(rgb);
  return (h <= 18 || h >= 342) && s >= 0.45 && v >= 0.45;
}

/** Score a candidate polygon's colours: yellow fill is the strong signal
 *  (+2), red stroke supporting (+1). A score ≥ 2 means "this is the parcel". */
export function parcelColorScore(fill: RGB | null | undefined, stroke: RGB | null | undefined): number {
  let score = 0;
  if (fill && isYellowishFill(fill)) score += 2;
  if (stroke && isReddishStroke(stroke)) score += 1;
  return score;
}
