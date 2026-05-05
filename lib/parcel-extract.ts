import type { ParcelSummary } from "./types";

const MAX_DIM = 2000; // cap rendered image dimension before storing/OCR'ing
const JPEG_QUALITY = 0.85;

/**
 * Convert any image File or PDF File into a downscaled JPEG data URL.
 * For PDFs, renders page 1 only.
 */
export async function fileToImage(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) return await pdfFirstPageToImage(file);
  return await imageFileToImage(file);
}

async function imageFileToImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return drawToCanvas(img.naturalWidth, img.naturalHeight, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfFirstPageToImage(file: File): Promise<string> {
  // Dynamic imports keep the bundle slim; only loaded when the user uses this tab.
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);

  // Render at high DPI so OCR has enough detail
  const baseViewport = page.getViewport({ scale: 1 });
  const dpiScale = Math.min(
    MAX_DIM / Math.max(baseViewport.width, baseViewport.height),
    2.5
  );
  const viewport = page.getViewport({ scale: Math.max(1.5, dpiScale) });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  // Downscale & re-encode to JPEG to keep it light for storage
  return downscaleCanvas(canvas);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function drawToCanvas(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  draw(ctx, w, h);
  return downscaleCanvas(canvas);
}

function downscaleCanvas(src: HTMLCanvasElement): string {
  const { width, height } = src;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  if (scale === 1) return src.toDataURL("image/jpeg", JPEG_QUALITY);
  const c = document.createElement("canvas");
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", JPEG_QUALITY);
}

/** Run Tesseract OCR on a data URL. Returns the recognised text. */
export async function runOCR(
  imageDataUrl: string,
  onProgress?: (p: number) => void
): Promise<string> {
  const Tesseract: any = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text" && onProgress) onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(imageDataUrl);
    return (data?.text as string) ?? "";
  } finally {
    await worker.terminate();
  }
}

/** Extract a structured ParcelSummary from raw OCR text using regex heuristics. */
export function extractSummary(text: string): ParcelSummary {
  const T = text.replace(/ /g, " ");
  const summary: ParcelSummary = {};

  const m = (re: RegExp): string | undefined => {
    const r = re.exec(T);
    return r?.[1]?.trim();
  };
  const num = (re: RegExp): number | undefined => {
    const v = m(re);
    if (!v) return undefined;
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  summary.plotNumber = m(/plot\s*(?:no|number|#)\s*[:\.]?\s*([A-Z0-9\-\/]+)/i);
  summary.community = m(/community(?:\s+name)?\s*[:\.]?\s*([A-Z][A-Z\s\-&\.]{2,40})/i);
  summary.sector = m(/(?:sector|sub[\s-]*community)\s*[:\.]?\s*([A-Z0-9][A-Z0-9\s\-]{1,30})/i);
  summary.plotAreaM2 = num(/(?:plot\s+area|land\s+area|area)\s*[:\.]?\s*([\d,]+\.?\d*)\s*(?:sq\.?\s*m|m²|m2|sqm)/i);
  summary.far = num(/F\.?A\.?R\.?\s*[:\.]?\s*([\d.]+)/i);
  summary.heightM = num(/(?:max(?:imum)?\s+)?(?:building\s+)?height\s*[:\.]?\s*([\d.]+)\s*m\b/i);
  summary.setbackFrontM = num(/front\s+set[\s-]*back\s*[:\.]?\s*([\d.]+)\s*m/i);
  summary.setbackSideM = num(/(?:side|left|right)\s+set[\s-]*back\s*[:\.]?\s*([\d.]+)\s*m/i);
  summary.setbackRearM = num(/rear\s+set[\s-]*back\s*[:\.]?\s*([\d.]+)\s*m/i);
  summary.permittedUse = m(/(?:permitted|allowed)\s+use\s*[:\.]?\s*([A-Z][A-Z\s,\-\/]+)/i);

  // Clean up trailing/leading punctuation in string fields
  for (const k of ["plotNumber", "community", "sector", "permittedUse"] as const) {
    if (summary[k]) summary[k] = summary[k]!.replace(/[\s\-:.,]+$/g, "").trim();
  }

  return summary;
}
