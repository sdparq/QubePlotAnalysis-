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

export const DEFAULT_SCHEME_PROMPT = `Create an architectural axonometric diagram based strictly on the provided axonometric geometry. Flat vector illustration style, Adobe Illustrator look. Soft pastel color palette (light greens, beige, light blue, grey). Simple solid volumes, no textures, no realism. Clean outlines, thin consistent strokes. Diagrammatic urban axonometry with simplified buildings, trees as circular symbols, soft landscape shapes, dashed annotation lines, icons and labels. Professional architecture presentation board style, clear hierarchy, white background, minimal shadows, schematic and readable.
Do not change geometry or proportions, only apply graphic style. No anotations`;

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
