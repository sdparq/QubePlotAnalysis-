import { describe, it, expect } from "vitest";
import { extractEdgeLabels, tryAutoCalibrate } from "./plot-auto-calibrate";
import type { PdfTextItem } from "./parcel-extract";

// Synthetic rectangle: 400×200 px, at real scale 0.1 m/px → 40 m × 20 m.
const RECT = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 200 },
  { x: 0, y: 200 },
];

function labelsAtEdgeMidpoints(scale: number, offsets: number[] = [0, 0, 0, 0]): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  for (let i = 0; i < RECT.length; i++) {
    const a = RECT[i];
    const b = RECT[(i + 1) % RECT.length];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const lenPx = Math.hypot(b.x - a.x, b.y - a.y);
    const metres = lenPx * scale + offsets[i];
    items.push({ text: `${metres.toFixed(2)} (${(metres * 3.28084).toFixed(2)} ft)`, x: midX, y: midY });
  }
  return items;
}

describe("extractEdgeLabels", () => {
  it("matches a single-run 'X.XX (Y.YY ft)' label", () => {
    const out = extractEdgeLabels([{ text: "51.49 (168.93 ft)", x: 10, y: 10 }]);
    expect(out).toHaveLength(1);
    expect(out[0].metres).toBeCloseTo(51.49, 2);
  });

  it("merges a label split across consecutive nearby text runs", () => {
    const out = extractEdgeLabels([
      { text: "16.53 ", x: 10, y: 10 },
      { text: "(54.23", x: 30, y: 10 },
      { text: " ft)", x: 50, y: 10 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].metres).toBeCloseTo(16.53, 2);
  });

  it("ignores road-width callouts without a matching ft companion", () => {
    const out = extractEdgeLabels([{ text: "ROAD 24.38", x: 10, y: 10 }]);
    expect(out).toHaveLength(0);
  });

  it("ignores bare coordinate labels", () => {
    const out = extractEdgeLabels([{ text: "493570E", x: 10, y: 10 }, { text: "2788130N", x: 10, y: 20 }]);
    expect(out).toHaveLength(0);
  });

  it("does not merge text runs that are far apart", () => {
    const out = extractEdgeLabels([
      { text: "16.53 ", x: 10, y: 10 },
      { text: "(54.23 ft)", x: 500, y: 500 },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("tryAutoCalibrate", () => {
  it("recovers the exact scale when all four edges are labelled consistently", () => {
    const scale = 0.1; // 1 px = 0.1 m
    const items = labelsAtEdgeMidpoints(scale);
    const result = tryAutoCalibrate(RECT, items);
    expect(result).not.toBeNull();
    expect(result!.confident).toBe(true);
    expect(result!.matches).toHaveLength(4);
    expect(result!.scale).toBeCloseTo(scale, 4);
    expect(result!.deviationPct).toBeCloseTo(0, 1);
  });

  it("stays confident with small rounding noise across edges", () => {
    const scale = 0.0537; // arbitrary non-round scale, like a real plan
    const items = labelsAtEdgeMidpoints(scale, [0.01, -0.01, 0.02, 0]);
    const result = tryAutoCalibrate(RECT, items);
    expect(result).not.toBeNull();
    expect(result!.confident).toBe(true);
    expect(result!.scale).toBeCloseTo(scale, 2);
  });

  it("flags low confidence when matched edges disagree", () => {
    // Two edges say one scale, two edges say a very different scale.
    const items = [
      ...labelsAtEdgeMidpoints(0.1).slice(0, 2),
      ...labelsAtEdgeMidpoints(0.2).slice(2, 4),
    ];
    const result = tryAutoCalibrate(RECT, items);
    expect(result).not.toBeNull();
    expect(result!.confident).toBe(false);
  });

  it("returns null with no text at all", () => {
    expect(tryAutoCalibrate(RECT, [])).toBeNull();
  });

  it("returns null when only one edge matches (not enough to cross-check)", () => {
    const items = labelsAtEdgeMidpoints(0.1).slice(0, 1);
    const result = tryAutoCalibrate(RECT, items);
    expect(result).toBeNull();
  });

  it("ignores labels far from every edge (e.g. unrelated road dimensions)", () => {
    const items = [
      ...labelsAtEdgeMidpoints(0.1),
      { text: "999.99 (3280.84 ft)", x: 5000, y: 5000 },
    ];
    const result = tryAutoCalibrate(RECT, items);
    expect(result).not.toBeNull();
    expect(result!.matches).toHaveLength(4);
    expect(result!.matches.every((m) => m.labelMetres < 100)).toBe(true);
  });
});

import { simplifyPolygon, polygonArea } from "./geom";

describe("simplifyPolygon", () => {
  it("collapses a noisy PDF-style outline to its true corners", () => {
    // Rectangle whose top edge is chopped into dozens of 2px sub-segments
    // with sub-pixel jitter — like the decoration-riddled paths extracted
    // from DLD affection plans.
    const noisy: { x: number; y: number }[] = [];
    for (let x = 0; x <= 400; x += 2) noisy.push({ x, y: (x / 2) % 2 === 0 ? 0 : 0.4 });
    noisy.push({ x: 400, y: 200 });
    noisy.push({ x: 0, y: 200 });
    const out = simplifyPolygon(noisy, 2);
    expect(out.length).toBe(4);
    expect(polygonArea(out)).toBeCloseTo(80000, -2);
  });

  it("leaves an already-clean polygon untouched", () => {
    const clean = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 },
    ];
    expect(simplifyPolygon(clean, 2)).toEqual(clean);
  });
});

describe("tryAutoCalibrate · consensus vs proximity", () => {
  it("assigns by scale consensus when a label sits nearer to the wrong edge", () => {
    // True scale 0.1. The label for edge 1 (200px → 20 m) is placed slightly
    // nearer to edge 0 than to its own edge; pure nearest-edge matching would
    // pair it with edge 0 (400px → implied 0.05) and wreck the median.
    const scale = 0.1;
    const items = [
      { text: "40.00 (131.23 ft)", x: 200, y: 8 },   // edge 0 (400 px, its own)
      { text: "20.00 (65.62 ft)", x: 390, y: 30 },   // edge 1's label, drifted toward the corner
      { text: "40.00 (131.23 ft)", x: 200, y: 192 }, // edge 2 (400 px)
      { text: "20.00 (65.62 ft)", x: 8, y: 100 },    // edge 3 (200 px)
    ];
    const result = tryAutoCalibrate(RECT, items);
    expect(result).not.toBeNull();
    expect(result!.confident).toBe(true);
    expect(result!.scale).toBeCloseTo(scale, 3);
    // The drifted label must have ended up on edge 1, not edge 0.
    const e1 = result!.matches.find((m) => m.edgeIndex === 1);
    expect(e1?.labelMetres).toBeCloseTo(20, 2);
  });
});
