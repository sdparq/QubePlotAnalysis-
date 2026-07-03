import { polygonArea, polygonBBox, simplifyPolygon, type Point } from "./geom";
import { parcelColorScore, type RGB } from "./parcel-colors";

const MAX_DIM = 2400;
const JPEG_QUALITY = 0.9;
const MAX_CANDIDATES = 40;
const MIN_CANDIDATE_AREA_PX = 200;

/** A run of text extracted from a PDF page, positioned in the same downscaled
 *  image-pixel space as `candidatePolygons`. Used to auto-read dimension
 *  labels printed next to plot edges (e.g. "51.49 (168.93 ft)") so the plot
 *  can be scaled without the user clicking two reference points. */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}

export interface ProcessedParcel {
  imageDataUrl: string;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  /** Closed vector polygons detected inside the source PDF, in image-pixel
   *  coords, ranked parcel-coloured first. Empty when not a vector PDF. */
  candidatePolygons: Point[][];
  /** Index into `candidatePolygons` of the auto-detected subject parcel
   *  (yellow highlight fill, red boundary — the DLD affection-plan style),
   *  or null when no candidate is confidently the parcel. */
  autoParcelIndex: number | null;
  /** Text runs detected on the PDF page (dimension labels, cotas…). Empty for images or text-less PDFs. */
  textItems: PdfTextItem[];
}

/**
 * Convert any image File or PDF File into a downscaled JPEG data URL.
 * For PDFs, also extracts closed vector paths from the first page.
 */
export async function processParcel(file: File): Promise<ProcessedParcel> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return await pdfToProcessed(file);
  return await imageToProcessed(file);
}

/** Backwards compat with earlier callers */
export async function fileToImage(file: File): Promise<string> {
  return (await processParcel(file)).imageDataUrl;
}

async function imageToProcessed(file: File): Promise<ProcessedParcel> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = drawCanvas(img.naturalWidth, img.naturalHeight, (ctx, w, h) =>
      ctx.drawImage(img, 0, 0, w, h)
    );
    const { canvas: finalCanvas } = downscaleCanvasIfNeeded(canvas);
    return {
      imageDataUrl: finalCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
      imageNaturalWidth: finalCanvas.width,
      imageNaturalHeight: finalCanvas.height,
      candidatePolygons: [],
      autoParcelIndex: null,
      textItems: [],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfToProcessed(file: File): Promise<ProcessedParcel> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const dpiScale = Math.min(MAX_DIM / Math.max(baseViewport.width, baseViewport.height), 2.5);
  const renderScale = Math.max(1.5, dpiScale);
  const viewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  // Extract paths in viewport pixel coords, colour-tagged so the DLD-style
  // parcel highlight (yellow fill, red boundary) can be auto-detected.
  let candidates: TaggedPath[] = [];
  let autoParcelIndex: number | null = null;
  try {
    const opList = await page.getOperatorList();
    const tagged = extractPathsFromOpList(opList, pdfjsLib.OPS, viewport.transform);
    const ranked = filterCandidates(tagged, viewport.width, viewport.height);
    candidates = ranked.candidates;
    autoParcelIndex = ranked.autoParcelIndex;
  } catch (e) {
    console.warn("PDF path extraction failed:", e);
    candidates = [];
    autoParcelIndex = null;
  }

  // Extract text runs (dimension labels / cotas) in viewport pixel coords, for
  // auto-calibration. Best-effort — a scanned/rasterised PDF has no text layer
  // and this just comes back empty, falling back to manual calibration.
  let textItems: PdfTextItem[] = [];
  try {
    const textContent = await page.getTextContent();
    textItems = (textContent.items as any[])
      .filter((it) => typeof it.str === "string" && it.str.trim().length > 0 && Array.isArray(it.transform))
      .map((it) => {
        const t = it.transform as number[];
        const origin = applyMatrix(viewport.transform, t[4], t[5]);
        return { text: it.str as string, x: origin.x, y: origin.y };
      });
  } catch (e) {
    console.warn("PDF text extraction failed:", e);
    textItems = [];
  }

  const { canvas: finalCanvas, scale } = downscaleCanvasIfNeeded(canvas);
  let polygons = candidates.map((c) => c.points);
  if (scale !== 1) {
    polygons = polygons.map((p) => p.map((pt) => ({ x: pt.x * scale, y: pt.y * scale })));
    textItems = textItems.map((it) => ({ ...it, x: it.x * scale, y: it.y * scale }));
  }

  return {
    imageDataUrl: finalCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
    imageNaturalWidth: finalCanvas.width,
    imageNaturalHeight: finalCanvas.height,
    candidatePolygons: polygons,
    autoParcelIndex,
    textItems,
  };
}

/** Apply a PDF/canvas transform matrix [a,b,c,d,e,f] to a single point. */
function applyMatrix(m: number[], x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/* ------------------------ Path extraction ------------------------ */

/** A closed path with the colours it was painted with, when known. */
export interface TaggedPath {
  points: Point[];
  fill: RGB | null;
  stroke: RGB | null;
}

function parseRgbArgs(args: any): RGB | null {
  // pdf.js canvas receives setFill/StrokeRGBColor(r, g, b) with 0–255 values;
  // the operator list stores them as a 3-element args array. Some builds pack
  // them into a single nested array — handle both.
  const a = Array.isArray(args) && args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (!a || a.length < 3) return null;
  const [r, g, b] = [Number(a[0]), Number(a[1]), Number(a[2])];
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  // Normalise 0–1 floats (some colour spaces) to 0–255.
  const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
  return [r * scale, g * scale, b * scale];
}

export function extractPathsFromOpList(opList: any, OPS: any, viewportTransform: number[]): TaggedPath[] {
  const paths: TaggedPath[] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  let fillColor: RGB | null = null;
  let strokeColor: RGB | null = null;
  const stateStack: Array<{ ctm: number[]; fill: RGB | null; stroke: RGB | null }> = [];

  // Paint operators that can follow a constructPath. Tell us whether the
  // just-built path was filled, stroked or both — and therefore which of the
  // current colours actually apply to it.
  const FILL_OPS = new Set([OPS.fill, OPS.eoFill].filter((v) => v !== undefined));
  const STROKE_OPS = new Set([OPS.stroke, OPS.closeStroke].filter((v) => v !== undefined));
  const FILL_STROKE_OPS = new Set(
    [OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((v) => v !== undefined),
  );

  function tx(x: number, y: number): Point {
    const a = ctm[0] * x + ctm[2] * y + ctm[4];
    const b = ctm[1] * x + ctm[3] * y + ctm[5];
    const vx = viewportTransform[0] * a + viewportTransform[2] * b + viewportTransform[4];
    const vy = viewportTransform[1] * a + viewportTransform[3] * b + viewportTransform[5];
    return { x: vx, y: vy };
  }

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      stateStack.push({ ctm: [...ctm], fill: fillColor, stroke: strokeColor });
    } else if (fn === OPS.restore) {
      const popped = stateStack.pop();
      if (popped) {
        ctm = popped.ctm;
        fillColor = popped.fill;
        strokeColor = popped.stroke;
      }
    } else if (fn === OPS.transform) {
      // args = [a, b, c, d, e, f]
      ctm = mulMatrix(ctm, args as number[]);
    } else if (fn === OPS.setFillRGBColor) {
      fillColor = parseRgbArgs(args);
    } else if (fn === OPS.setStrokeRGBColor) {
      strokeColor = parseRgbArgs(args);
    } else if (fn === OPS.setFillGray) {
      const g = Number(args?.[0]);
      if (Number.isFinite(g)) {
        const v = g <= 1 ? g * 255 : g;
        fillColor = [v, v, v];
      }
    } else if (fn === OPS.setStrokeGray) {
      const g = Number(args?.[0]);
      if (Number.isFinite(g)) {
        const v = g <= 1 ? g * 255 : g;
        strokeColor = [v, v, v];
      }
    } else if (fn === OPS.constructPath) {
      // args = [pathOps[], pathArgs[], ...]
      const pathOps: number[] = args[0];
      const pathArgs: number[] = args[1];
      const built: Point[][] = [];
      let currentPath: Point[] = [];
      let argIdx = 0;

      const pushIfClosed = () => {
        if (currentPath.length >= 3) built.push(currentPath);
        currentPath = [];
      };

      for (const op of pathOps) {
        if (op === OPS.moveTo) {
          pushIfClosed();
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          currentPath.push(tx(x, y));
        } else if (op === OPS.lineTo) {
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          currentPath.push(tx(x, y));
        } else if (op === OPS.curveTo) {
          argIdx += 4;
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          currentPath.push(tx(x, y));
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          argIdx += 2;
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          currentPath.push(tx(x, y));
        } else if (op === OPS.closePath) {
          if (currentPath.length >= 3) {
            built.push(currentPath);
            currentPath = [];
          }
        } else if (op === OPS.rectangle) {
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          const w = pathArgs[argIdx++];
          const h = pathArgs[argIdx++];
          built.push([tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)]);
        }
      }
      if (currentPath.length >= 3) built.push(currentPath);

      // The paint op follows the path construction — it decides which colours
      // this path was actually rendered with.
      const nextFn = opList.fnArray[i + 1];
      let fill: RGB | null = null;
      let stroke: RGB | null = null;
      if (FILL_STROKE_OPS.has(nextFn)) {
        fill = fillColor;
        stroke = strokeColor;
      } else if (FILL_OPS.has(nextFn)) {
        fill = fillColor;
      } else if (STROKE_OPS.has(nextFn)) {
        stroke = strokeColor;
      } else {
        // Unknown/absent paint op (clip paths etc.) — keep both as a hint.
        fill = fillColor;
        stroke = strokeColor;
      }
      for (const p of built) paths.push({ points: p, fill, stroke });
    }
  }
  return paths;
}

/** Filter + rank candidates. Parcel-coloured polygons (yellow fill / red
 *  stroke) sort first, then by area. Returns the ranked candidates and the
 *  index of a confidently auto-detected parcel (or null). */
export function filterCandidates(
  paths: TaggedPath[],
  pageW: number,
  pageH: number,
): { candidates: TaggedPath[]; autoParcelIndex: number | null } {
  const pageArea = pageW * pageH;
  const enriched = paths
    .filter((p) => p.points.length >= 3)
    .map((p) => ({
      ...p,
      area: polygonArea(p.points),
      bbox: polygonBBox(p.points),
      score: parcelColorScore(p.fill, p.stroke),
    }))
    .filter(({ area, bbox }) => {
      if (area < MIN_CANDIDATE_AREA_PX) return false;
      // Drop page borders (cover most of the page)
      if (bbox.w > pageW * 0.92 && bbox.h > pageH * 0.92) return false;
      // Drop near-zero-thickness slivers
      if (bbox.w < 6 || bbox.h < 6) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score || b.area - a.area)
    .slice(0, MAX_CANDIDATES);

  // Auto-detect: the top candidate must have the yellow highlight fill
  // (score ≥ 2) and be big enough that it can't be a legend swatch.
  const top = enriched[0];
  const autoParcelIndex =
    top && top.score >= 2 && top.area >= pageArea * 0.003 ? 0 : null;

  // PDF paths often carry hundreds of sub-pixel decoration segments (dashes,
  // hatching) on top of the true corners — simplify each candidate so what we
  // trace, match cotas against, and eventually push into Massing is the real
  // corner set.
  return {
    candidates: enriched.map(({ points, fill, stroke }) => ({
      points: simplifyPolygon(points, 2),
      fill,
      stroke,
    })),
    autoParcelIndex,
  };
}

/* ------------------------ Helpers ------------------------ */

function mulMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function drawCanvas(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h);
  return canvas;
}

function downscaleCanvasIfNeeded(src: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const { width, height } = src;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  if (scale === 1) return { canvas: src, scale: 1 };
  const c = document.createElement("canvas");
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { canvas: c, scale };
}
