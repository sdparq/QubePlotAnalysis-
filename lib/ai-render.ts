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

export const DEFAULT_SCHEME_PROMPT = `Create an architectural axonometric diagram based strictly on the provided axonometric geometry. Flat vector illustration style, Adobe Illustrator look. Soft pastel color palette (light greens, beige, light blue, grey). Simple solid volumes, no textures, no realism. Clean outlines, thin consistent strokes. Diagrammatic urban axonometry with simplified buildings, trees as circular symbols, soft landscape shapes, professional architecture presentation board style, clear hierarchy, white background, minimal shadows, schematic and readable.

OUR PROJECT (the green / highlighted volume): redraw it as a residential building with a clear residential facade rhythm — regular bays of windows with recessed balconies / loggias punched into the facade (visible insets where the volume is carved back floor by floor). Keep the silhouette and total height exactly as in the input. Use a soft pastel green / sage tone for the body, slightly darker for the recessed balcony interiors.

If a podium / base step is visible at the bottom of our volume, treat it as an amenity podium with a small differentiating roofscape on top: a rectangular swimming pool drawn in light blue, surrounded by sun-lounger dots, a couple of pergolas or shaded patches in soft green, and small tree symbols. The podium walls themselves stay flat-coloured in a slightly warmer beige to read as a different programme.

SURROUNDINGS: keep the white neighbouring volumes as flat pastel-white blocks with thin outlines, but enrich the public realm — generous vegetation scattered along the streets and between buildings (dense clusters of circular tree symbols in two or three soft greens), small parks / planted strips, hedges drawn as soft rounded shapes, a few stylised cars on the roads, sidewalks hinted in light grey. Add a light atmospheric feel: soft cast shadows under each volume, subtle gradient on the ground, gentle ambient palette.

Do not change geometry or proportions of any volume, only apply graphic style. No annotations, no labels, no text.`;

export const DEFAULT_HYPERREAL_PROMPT = `Transform the provided axonometric massing into a photorealistic architectural rendering in the visual language of BIG (Bjarke Ingels Group), MVRDV and Heatherwick Studio — bold, sculptural, modern, iconic.

ABSOLUTE GEOMETRIC FIDELITY (highest priority — do not negotiate):
- This is an image-to-image render. The output must overlay onto the input pixel-for-pixel for the silhouette of the project volume.
- Reuse the EXACT camera angle, framing, zoom and crop of the input. Do NOT re-frame, pan, dolly, change aspect ratio or rotate the building.
- Preserve the exact footprint, total height, podium step, courtyards / holes and every set-back of the highlighted project volume.
- Do NOT invent extra floors, towers, extrusions, antennas, spires or roof features.
- If a GEOMETRY FACTS block is given above, the storey counts and floor heights it lists are exact — match them. Draw exactly that many horizontal floor-slab bands on the tower facade so the floors can be counted in the result.

PROJECT BUILDING (the highlighted volume): contemporary residential tower with a striking sculptural facade. White architectural concrete or off-white fibre-cement panels, full-height floor-to-ceiling glazing in dark anodised aluminium frames, regular bays of glazing and deeply carved balcony loggias revealing warm timber soffits and slatted oak screens. Crisp shadow lines on every floor slab — one shadow line per storey listed in the geometry facts above. Disciplined parametric rhythm. Soft reflections of sky and context on the glass.

If the volume includes a podium step, treat the podium roof as a lush landscaped amenity deck: infinity-edge swimming pool with turquoise water and travertine coping, timber decking, planters with mediterranean trees and ornamental grasses, pergolas with white tensile shading, lounge furniture, outdoor kitchen — composed and photographed from above.

LIGHTING & ATMOSPHERE: golden-hour sun, warm low-angle directional light from one side casting long crisp shadows, soft global illumination, clear blue sky with a few thin cirrus clouds, gentle atmospheric haze in the distance. High dynamic range, physically based rendering, realistic ambient occlusion in every corner, subtle bloom on glazing highlights. Cinematic colour grade — clean whites, warm timber accents, lush greens, deep cobalt sky.

CONTEXT: keep the surrounding neighbour volumes in their exact positions but render them realistically — sandy beige stone, glass curtain walls or rendered plaster facades typical of contemporary Dubai mid-rise architecture, all clearly subordinate to the project building. The ground plane reads as a real urban site: clean asphalt streets with lane markings, granite kerbs, generous wide pedestrian sidewalks in pale stone, mature street trees (date palms and ficus) with detailed canopies casting dappled shadows, small landscaped strips with shrubs and groundcover, parked cars, a few pedestrians for scale, bicycles. Subtle reflections in glazing on neighbour buildings.

QUALITY: ultra-high-resolution architectural visualisation, sharp focus throughout, professional V-Ray / Corona / Lumion / Enscape look, magazine-cover composition, suitable for a developer marketing brochure. No labels, no text, no people that are recognisable, no logos.`;

export const DEFAULT_WALK_HYPERREAL_PROMPT = `Transform this street-level 3D viewport capture into a photorealistic eye-level architectural photograph, in the visual language of a professional archviz still (V-Ray / Corona / Lumion look).

ABSOLUTE GEOMETRIC FIDELITY (highest priority — do not negotiate):
- This is an image-to-image render. Reuse the EXACT camera position, eye height, angle, lens/field of view, framing and crop of the input. Do NOT re-frame, pan, dolly, zoom or rotate.
- The project building's silhouette, footprint, storey count, podium step and every set-back must overlay the input pixel-for-pixel. Do NOT invent extra floors or roof features.
- If the input image shows corrected (perfectly parallel) verticals — an architectural tilt-shift view — preserve exactly parallel verticals in the output too.
- If a GEOMETRY FACTS block is given above, the storey counts and floor heights it lists are exact — match them.

PROJECT BUILDING (the building the camera faces, with the detailed facade): contemporary residential tower. White architectural concrete or off-white fibre-cement panels, full-height glazing in dark anodised aluminium frames, deeply carved balcony loggias with warm timber soffits and glass balustrades, crisp shadow lines on every floor slab. Ground/podium levels keep their vertical fin / louvre screens as elegant bronze-anodised brise-soleil.

SETTING — Dubai / Abu Dhabi residential district: this is a dense Gulf-city neighbourhood. The simple box-shaped neighbour volumes in the input are placeholders — render them as realistic contemporary RESIDENTIAL HIGH-RISES and mid-rises: glass curtain walls, sand-toned stone and render, balconies, rooftop amenities — keeping their exact positions and heights. Fill the background haze with a believable residential skyline of further towers. Streets with clean asphalt and lane markings, pale stone sidewalks, granite kerbs, date palms and ficus trees with detailed canopies, landscaped planting strips, street lights, a few pedestrians for scale.

LIGHTING & ATMOSPHERE: late-afternoon Gulf sunlight, warm directional light with long soft shadows across the street, clear blue sky with thin haze near the horizon, gentle heat shimmer in the far distance. Physically based rendering, realistic ambient occlusion, subtle bloom on glazing highlights, cinematic colour grade.

QUALITY: ultra-high-resolution architectural visualisation, sharp focus, magazine-quality composition, suitable for a developer marketing brochure. No labels, no text, no recognisable faces, no logos.`;

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
