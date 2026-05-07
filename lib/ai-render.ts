/**
 * Image-to-image rendering of the 3D massing viewer through Google Gemini.
 * Preserves the massing layout from the input image and re-renders it as a
 * stylised axonometric architectural scheme.
 *
 * Tries several known image-generation model names in cascade — different AI
 * Studio accounts/regions expose different sets of preview/GA models, so we
 * fall back through 2.5 → 2.0 until one accepts the request.
 */

export interface AiRenderResult {
  imageDataUrl: string;
  textNote?: string;
  modelUsed?: string;
}

const FALLBACK_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-exp",
];

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

async function callGeminiOnce(
  apiKey: string,
  base64: string,
  prompt: string,
  model: string,
  signal?: AbortSignal,
): Promise<AiRenderResult> {
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
    const err = new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
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
  return { imageDataUrl, textNote, modelUsed: model };
}

export async function renderSchemeWithGemini(
  apiKey: string,
  inputPngDataUrl: string,
  prompt: string = DEFAULT_SCHEME_PROMPT,
  signal?: AbortSignal,
): Promise<AiRenderResult> {
  const base64 = inputPngDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
  let lastError: Error | null = null;
  for (const model of FALLBACK_MODELS) {
    try {
      return await callGeminiOnce(apiKey, base64, prompt, model, signal);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const status = (err as Error & { status?: number }).status;
      // Only fall through on "model not available" errors. Anything else
      // (auth, quota, server error, image-not-returned) is fatal.
      if (status === 404 || /not found|NOT_FOUND|not supported/i.test(err.message)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `No image-generation model is available for this API key. Last error:\n${lastError?.message ?? "unknown"}\n\nTried: ${FALLBACK_MODELS.join(", ")}.\nVerify your key has access to a Gemini image-gen model at aistudio.google.com.`,
  );
}
