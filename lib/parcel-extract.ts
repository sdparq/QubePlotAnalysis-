import { polygonArea, polygonBBox, type Point } from "./geom";

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
  /** Closed vector polygons detected inside the source PDF, in image-pixel coords. Empty when not a vector PDF. */
  candidatePolygons: Point[][];
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

  // Extract paths in viewport pixel coords
  let paths: Point[][] = [];
  try {
    const opList = await page.getOperatorList();
    paths = extractPathsFromOpList(opList, pdfjsLib.OPS, viewport.transform);
    paths = filterCandidates(paths, viewport.width, viewport.height);
  } catch (e) {
    console.warn("PDF path extraction failed:", e);
    paths = [];
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
  if (scale !== 1) {
    paths = paths.map((p) => p.map((pt) => ({ x: pt.x * scale, y: pt.y * scale })));
    textItems = textItems.map((it) => ({ ...it, x: it.x * scale, y: it.y * scale }));
  }

  return {
    imageDataUrl: finalCanvas.toDataURL("image/jpeg", JPEG_QUALITY),
    imageNaturalWidth: finalCanvas.width,
    imageNaturalHeight: finalCanvas.height,
    candidatePolygons: paths,
    textItems,
  };
}

/** Apply a PDF/canvas transform matrix [a,b,c,d,e,f] to a single point. */
function applyMatrix(m: number[], x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/* ------------------------ Path extraction ------------------------ */

function extractPathsFromOpList(opList: any, OPS: any, viewportTransform: number[]): Point[][] {
  const paths: Point[][] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const ctmStack: number[][] = [];

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
      ctmStack.push([...ctm]);
    } else if (fn === OPS.restore) {
      const popped = ctmStack.pop();
      if (popped) ctm = popped;
    } else if (fn === OPS.transform) {
      // args = [a, b, c, d, e, f]
      ctm = mulMatrix(ctm, args as number[]);
    } else if (fn === OPS.constructPath) {
      // args = [pathOps[], pathArgs[], ...]
      const pathOps: number[] = args[0];
      const pathArgs: number[] = args[1];
      let currentPath: Point[] = [];
      let argIdx = 0;

      const pushIfClosed = () => {
        if (currentPath.length >= 3) paths.push(currentPath);
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
            paths.push(currentPath);
            currentPath = [];
          }
        } else if (op === OPS.rectangle) {
          const x = pathArgs[argIdx++];
          const y = pathArgs[argIdx++];
          const w = pathArgs[argIdx++];
          const h = pathArgs[argIdx++];
          paths.push([tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)]);
        }
      }
      if (currentPath.length >= 3) paths.push(currentPath);
    }
  }
  return paths;
}

function filterCandidates(paths: Point[][], pageW: number, pageH: number): Point[][] {
  const pageArea = pageW * pageH;
  const filtered = paths
    .filter((p) => p.length >= 3)
    .map((p) => ({ points: p, area: polygonArea(p), bbox: polygonBBox(p) }))
    .filter(({ area, bbox }) => {
      if (area < MIN_CANDIDATE_AREA_PX) return false;
      // Drop page borders (cover most of the page)
      if (bbox.w > pageW * 0.92 && bbox.h > pageH * 0.92) return false;
      // Drop near-zero-thickness slivers
      if (bbox.w < 6 || bbox.h < 6) return false;
      return true;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_CANDIDATES);
  return filtered.map((c) => c.points);
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
