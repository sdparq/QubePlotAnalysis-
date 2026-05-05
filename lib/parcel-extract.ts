const MAX_DIM = 2400;
const JPEG_QUALITY = 0.9;

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
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const dpiScale = Math.min(MAX_DIM / Math.max(baseViewport.width, baseViewport.height), 2.5);
  const viewport = page.getViewport({ scale: Math.max(1.5, dpiScale) });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

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
