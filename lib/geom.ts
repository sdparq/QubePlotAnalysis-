export type Point = { x: number; y: number };

export function polygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a / 2);
}

export function polygonCentroid(poly: Point[]): Point {
  if (poly.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    a += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return { x: cx, y: cy };
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function isCounterClockwise(poly: Point[]): boolean {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a > 0;
}

export function edgeLengths(poly: Point[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    r.push(Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y));
  }
  return r;
}

export function polygonPerimeter(poly: Point[]): number {
  return edgeLengths(poly).reduce((s, l) => s + l, 0);
}

export function polygonBBox(poly: Point[]) {
  if (poly.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0, cx: 0, cy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function lineLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * Inward (positive distance) polygon offset using edge normals + line intersections.
 * Works robustly for convex polygons; concave polygons may produce artifacts at re-entrant corners.
 * Returns [] if the inset collapses or self-intersects.
 */
export function offsetPolygon(poly: Point[], distance: number): Point[] {
  if (poly.length < 3) return [];
  if (Math.abs(distance) < 1e-9) return poly.slice();
  const ccw = isCounterClockwise(poly);
  const sign = ccw ? 1 : -1;

  type Edge = { p: Point; dir: Point };
  const offsetEdges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len;
    const uy = dy / len;
    // Inward normal: rotate edge direction by +90° for CCW, -90° for CW
    const nx = -uy * sign;
    const ny = ux * sign;
    offsetEdges.push({
      p: { x: a.x + nx * distance, y: a.y + ny * distance },
      dir: { x: ux, y: uy },
    });
  }

  const result: Point[] = [];
  for (let i = 0; i < offsetEdges.length; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % offsetEdges.length];
    const inter = lineLineIntersection(
      e1.p,
      { x: e1.p.x + e1.dir.x, y: e1.p.y + e1.dir.y },
      e2.p,
      { x: e2.p.x + e2.dir.x, y: e2.p.y + e2.dir.y }
    );
    if (inter) result.push(inter);
  }
  if (result.length < 3) return [];
  if (polygonArea(result) < 0.01) return [];
  return result;
}

export function scalePolygon(poly: Point[], scale: number, around?: Point): Point[] {
  const c = around ?? polygonCentroid(poly);
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale }));
}

export function scalePolygonToArea(poly: Point[], targetArea: number): Point[] {
  const cur = polygonArea(poly);
  if (cur < 1e-9 || targetArea < 1e-9) return [];
  return scalePolygon(poly, Math.sqrt(targetArea / cur));
}

export function translatePolygon(poly: Point[], dx: number, dy: number): Point[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function rectangleToPolygon(frontage: number, depth: number, sFront = 0, sRear = 0, sSide = 0): Point[] {
  // 2D convention: -y is the FRONT of the plot (rendered toward the camera).
  // sFront eats from the -y edge, sRear eats from the +y edge.
  const halfW = frontage / 2 - sSide;
  const front = -depth / 2 + sFront;
  const rear = depth / 2 - sRear;
  return [
    { x: -halfW, y: front },
    { x: halfW, y: front },
    { x: halfW, y: rear },
    { x: -halfW, y: rear },
  ];
}

export function rectanglePlotPolygon(frontage: number, depth: number): Point[] {
  return [
    { x: -frontage / 2, y: -depth / 2 },
    { x: frontage / 2, y: -depth / 2 },
    { x: frontage / 2, y: depth / 2 },
    { x: -frontage / 2, y: depth / 2 },
  ];
}
