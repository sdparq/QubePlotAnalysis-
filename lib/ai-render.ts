/**
 * Image-to-image rendering of the 3D massing viewer.
 *
 * Two engines:
 *   - Google Gemini 2.5 Flash Image (image-to-image, preserves the layout).
 *     Requires an AI Studio API key (free tier covers image generation).
 *   - Pollinations / FLUX (text-to-image, no key, fully free, but the
 *     resulting massing is generative — doesn't reflect the input).
 */

export interface AiRenderResult {
  imageDataUrl: string;
  textNote?: string;
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-image-preview";

export const DEFAULT_SCHEME_PROMPT = `Render this 3D massing study as a clean architectural axonometric scheme in the style of Bjarke Ingels Group (BIG).

CRITICAL: Preserve EXACTLY the camera angle, building positions, building heights, and outlines of every massing element shown in the input image. Do not move, rotate, scale or invent new buildings. The white blocks must stay as white blocks in the same positions. The greenish/highlighted block in the centre is OUR project building.

Surrounding white volumes: keep them as flat matte pure-white extruded volumes with thin black outlines. No windows, no texture, no surface detail. Render them as physical massing-model blocks — abstract.

OUR project building (the greenish one): re-render it as a residential building with:
- Soft warm beige plaster walls (around #d8c39a)
- A regular grid of square / rectangular windows with dark blue-grey glass — one window per ~2.5 m of facade width and one row per floor
- A subtle floor-slab line between each floor
- A few small balconies with thin white parapets distributed along the facade
- A flat or slightly stepped roof in a slightly darker tone, optional small parapet
- The EXACT same silhouette, height and footprint as in the input — do not change its shape

Ground plane: flat light sand colour (~#ece4d2). Roads / streets in light grey.

Add small symbolic trees (cone-shaped, dark green) along the streets. Add a couple of stylised cars on roads. Keep these tiny and abstract — diagram symbols, not photoreal.

Sky: soft clear gradient from cream at horizon to muted sky-blue at top.

Aesthetic: clean axonometric architectural diagram, flat shading, thin clean outlines, no text, no labels, no people, no dramatic lighting. Tasteful BIG-style presentation diagram.

Output a single image with the same aspect ratio and orientation as the input.`;

export async function renderSchemeWithGemini(
  apiKey: string,
  inputPngDataUrl: string,
  prompt: string = DEFAULT_SCHEME_PROMPT,
  signal?: AbortSignal,
  model: string = DEFAULT_GEMINI_MODEL,
): Promise<AiRenderResult> {
  const base64 = inputPngDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/png", data: base64 } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let imageDataUrl: string | undefined;
  let textNote: string | undefined;
  for (const p of parts) {
    if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType ?? "image/png";
      imageDataUrl = `data:${mime};base64,${p.inlineData.data}`;
    } else if (p.text) {
      textNote = (textNote ?? "") + p.text;
    }
  }
  if (!imageDataUrl) {
    throw new Error(
      "Gemini did not return an image." + (textNote ? ` Model said: ${textNote.slice(0, 200)}` : ""),
    );
  }
  return { imageDataUrl, textNote };
}

/**
 * Free, no-key text-to-image fallback through pollinations.ai (FLUX model).
 * Returns a generated image but does NOT preserve the input layout — Pollinations
 * doesn't accept arbitrary inline image inputs.
 */
export async function renderSchemeWithPollinations(
  prompt: string = DEFAULT_SCHEME_PROMPT,
  signal?: AbortSignal,
): Promise<AiRenderResult> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=960&model=flux&nologo=true&enhance=true&seed=${seed}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Pollinations ${res.status}: ${res.statusText}`);
  }
  const blob = await res.blob();
  return await new Promise<AiRenderResult>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ imageDataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error("Failed to read Pollinations image"));
    reader.readAsDataURL(blob);
  });
}
