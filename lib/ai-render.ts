/**
 * Image-to-image rendering of the 3D massing viewer through Google's
 * Gemini 2.5 Flash Image model (a.k.a. "Nano Banana"). Preserves the
 * massing layout from the input image and re-renders it as a stylised
 * axonometric architectural scheme.
 */

export interface AiRenderResult {
  imageDataUrl: string;
  textNote?: string;
}

const DEFAULT_MODEL = "gemini-2.5-flash-image-preview";

export const DEFAULT_SCHEME_PROMPT = `Render this 3D massing study as a clean architectural axonometric scheme in the style of Bjarke Ingels Group (BIG).

Preserve EXACTLY the camera angle, building positions, building heights, plot location, and the layout of all surrounding white volumes shown in the input — do not move them, do not change their proportions, do not add new buildings.

Surrounding buildings: pure matte white extruded volumes with thin black outlines, no windows, no surface detail.

The greenish/highlighted central volume is OUR project — re-render it with a subtle residential character: a regular grid of square windows on its facades, soft warm beige wall colour, slightly darker flat roof. Keep the exact silhouette and footprint. A couple of small balconies are welcome.

Ground plane: light sand colour. Existing roads/streets visible as light grey ribbons.

Add small symbolic trees along the streets and a few minimalist cars on the roads — stylised, not photoreal, like a BIG diagram.

Sky: clear gradient from soft cream at the horizon to muted sky-blue at the top.

Aesthetic: clean axonometric architectural diagram, flat shading, thin outlines, no labels, no text, minimal and editorial. No people. No photoreal details. Output a single image.`;

export async function renderSchemeWithGemini(
  apiKey: string,
  inputPngDataUrl: string,
  prompt: string = DEFAULT_SCHEME_PROMPT,
  signal?: AbortSignal,
  model: string = DEFAULT_MODEL,
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
