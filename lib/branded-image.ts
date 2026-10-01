/**
 * Turns a 3D viewer capture into a presentation image: the render on top and
 * a dark title bar underneath with the project name, headline figures and the
 * product wordmark — ready to drop into a pitch deck or WhatsApp.
 */

export interface BrandedImageInfo {
  title: string;
  subtitle: string;
  stats: Array<[label: string, value: string]>;
  brand: string;
  tagline: string;
  /** Data credit printed in the corner of the render (e.g. OpenStreetMap). */
  attribution?: string;
}

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 8 8 L 72 8 L 92 28 L 92 92 L 28 92 L 8 72 Z" fill="none" stroke="#3fae5f" stroke-width="11" stroke-linejoin="miter" stroke-miterlimit="4"/></svg>`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image"));
    img.src = src;
  });
}

function uiFont(): string {
  if (typeof window === "undefined") return "system-ui, sans-serif";
  const inter = getComputedStyle(document.documentElement).getPropertyValue("--font-inter").trim();
  return `${inter ? `${inter}, ` : ""}ui-sans-serif, system-ui, sans-serif`;
}

/** Shrinks the font until `text` fits in `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, maxWidth: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

export async function composeBrandedImage(src: string, info: BrandedImageInfo): Promise<string> {
  const shot = await loadImage(src);
  const W = shot.width;
  const H = shot.height;
  const u = Math.max(1, W / 1400); // layout unit — everything scales with the export width
  const pad = Math.round(36 * u);
  const barH = Math.round(118 * u);
  const family = uiFont();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H + barH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;

  ctx.fillStyle = "#f6f4ee";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(shot, 0, 0);

  if (info.attribution) {
    const size = Math.round(11 * u);
    ctx.font = `400 ${size}px ${family}`;
    const tw = ctx.measureText(info.attribution).width;
    const px = Math.round(6 * u);
    const bx = W - tw - px * 2 - Math.round(10 * u);
    const by = H - size - px * 2 - Math.round(10 * u);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(bx, by, tw + px * 2, size + px * 2);
    ctx.fillStyle = "#3d4657";
    ctx.textBaseline = "top";
    ctx.fillText(info.attribution, bx + px, by + px);
    ctx.textBaseline = "alphabetic";
  }

  // Title bar
  ctx.fillStyle = "#0e0e0e";
  ctx.fillRect(0, H, W, barH);
  ctx.fillStyle = "#3fae5f";
  ctx.fillRect(0, H, W, Math.max(2, Math.round(3 * u)));

  const midY = H + barH / 2;

  // Brand, right-aligned
  const markSize = Math.round(40 * u);
  let brandLeft = W - pad;
  try {
    const mark = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(MARK_SVG)}`);
    ctx.font = `700 ${Math.round(19 * u)}px ${family}`;
    const brandText = info.brand.split("").join(String.fromCharCode(8202));
    const bw = ctx.measureText(brandText).width;
    const taglineSize = Math.round(12 * u);
    ctx.font = `400 ${taglineSize}px ${family}`;
    const tw = Math.min(ctx.measureText(info.tagline).width, 360 * u);
    const blockW = Math.max(bw, tw);
    brandLeft = W - pad - blockW - markSize - 12 * u;
    ctx.drawImage(mark, brandLeft, midY - markSize / 2, markSize, markSize);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(19 * u)}px ${family}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(brandText, brandLeft + markSize + 12 * u, midY - 2 * u);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    fitText(ctx, info.tagline, 400, taglineSize, family, 360 * u);
    ctx.fillText(info.tagline, brandLeft + markSize + 12 * u, midY + 18 * u);
  } catch {
    /* the bar still reads without the mark */
  }

  // Title block, left
  const titleMax = Math.min(W * 0.34, brandLeft - pad * 2);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  fitText(ctx, info.title, 600, Math.round(28 * u), family, titleMax);
  ctx.fillText(info.title, pad, midY + 2 * u);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  fitText(ctx, info.subtitle, 400, Math.round(14 * u), family, titleMax);
  ctx.fillText(info.subtitle, pad, midY + 26 * u);

  // Headline figures between the title and the brand
  const statsLeft = pad + titleMax + pad;
  const statsRight = brandLeft - pad;
  const n = info.stats.length;
  if (n > 0 && statsRight - statsLeft > 120 * u) {
    const colW = (statsRight - statsLeft) / n;
    info.stats.forEach(([label, value], i) => {
      const x = statsLeft + i * colW;
      if (i > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x - 12 * u, midY - 26 * u, Math.max(1, u), 52 * u);
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      fitText(ctx, label, 500, Math.round(12 * u), family, colW - 20 * u);
      ctx.fillText(label, x, midY - 8 * u);
      ctx.fillStyle = "#ffffff";
      fitText(ctx, value, 600, Math.round(22 * u), family, colW - 20 * u);
      ctx.fillText(value, x, midY + 20 * u);
    });
  }

  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}
