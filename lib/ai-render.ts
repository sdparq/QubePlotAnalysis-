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

export const DEFAULT_WALK_HYPERREAL_PROMPT = `TASK: Turn this rough grey 3D viewport capture into a HYPERREALISTIC eye-level PHOTOGRAPH of a real, lived-in city street in Dubai / Abu Dhabi — indistinguishable from a picture taken on a full-frame camera. Think of the job as RE-TEXTURING AND RELIGHTING the exact scene in the input — like rendering the same 3D model with photoreal materials — NOT as designing a new building. The finished image must show no trace of the clay-model look: no flat untextured surfaces, no plain boxes, no empty lifeless streets, no CGI plastic feel.

RULE #1 — THE PROJECT BUILDING'S GEOMETRY IS FIXED (overrides everything else in this prompt):
- The project building is the one the camera faces, the tall volume with the detailed gridded facade. Its silhouette must overlay the input PIXEL-FOR-PIXEL: same outline, same width, same height, same position in frame.
- Keep the SAME volumes in the SAME arrangement: if the input shows a podium block with a tower on top, the output shows that exact podium and that exact tower, with the tower sitting on the podium in exactly the same place. Every set-back, notch and step stays where it is.
- Do NOT change the plan shape, do NOT round or chamfer corners, do NOT taper or twist the tower, do NOT add or remove set-backs, do NOT merge, split, widen, slim, shorten or heighten any volume, do NOT add crowns, spires, antennas, fins that change the outline, or any roof feature that alters the silhouette.
- Same storey count: the input facade shows the real floor grid — reproduce one floor line per storey. If a GEOMETRY FACTS block is given above, its storey counts and floor heights are exact — match them.
- Before finishing, verify: would the output building's outline trace exactly over the input's? If not, it is wrong — fix the geometry, not the style.

CAMERA (do not negotiate):
- Reuse the EXACT camera position, eye height (~1.7 m), viewing angle, lens / field of view, framing and crop of the input. Do NOT re-frame, pan, dolly, zoom or rotate.
- If the input shows corrected, perfectly parallel verticals (an architectural tilt-shift view), keep the verticals perfectly parallel in the output too.

PROJECT BUILDING — MATERIALS ONLY (all creativity stays ON the existing surfaces, never reshaping them): dress the exact volumes above as a premium contemporary residential tower. Full-height glazing in dark anodised frames following the input's facade grid, believable interior life glimpsed through the glass (sheer curtains, pendant lights, plants, furniture silhouettes), the input's recessed balconies rendered as carved loggias with clear-glass balustrades, warm timber soffits and residents' planting spilling over some of them, crisp floor-slab shadow lines, off-white architectural concrete or stone-clad piers with visible material grain. Where the input shows vertical fins on the ground / podium levels, render those same fins as bronze-anodised brise-soleil; the ground floor becomes a welcoming arrival with a stone-framed lobby glowing warmly from inside and a landscaped edge — all within the existing podium envelope. Real reflections of sky, street and neighbouring towers move across the glazing.

CITY LIFE (essential — the street must feel inhabited): pedestrians at natural scale going about their day — residents strolling, a couple with a stroller, a jogger, someone walking a dog, people chatting in shade; a cyclist or delivery rider; a few parked cars along the kerb and one or two driving by (contemporary SUVs and saloons, no logos); a small ground-floor café terrace with parasols and seated guests where it plausibly fits. Faces small and not recognisable.

VEGETATION & STREETSCAPE: mature date palms and ficus with detailed sunlit canopies casting dappled shadow, lush planted medians and beds with ornamental grasses and bougainvillea in bloom, clipped hedges, pale stone sidewalks with realistic paving joints, granite kerbs, clean asphalt showing subtle tyre wear, manhole covers and faint kerb stains — the small imperfections that make a photo read as real. Street lamps, benches, low landscape lighting.

NEIGHBOURHOOD & SKYLINE: the plain box neighbours in the input are placeholders — replace them with believable contemporary Gulf residential high-rises and mid-rises (glass curtain walls, sand-toned stone and render, stacked balconies, rooftop amenities) keeping roughly their positions and heights, and fill the distance with a dense residential skyline dissolving into warm haze.

LIGHT & ATMOSPHERE: strong, believable Gulf sunlight — late-afternoon golden light raking across the street with long soft shadows, warm bounce light on shaded facades, clear sky graduating to a hazy horizon, faint heat shimmer far away. High dynamic range, physically plausible exposure, realistic ambient occlusion in every reveal, subtle bloom only on the brightest glass highlights.

PHOTO QUALITY: looks shot on a full-frame camera matching the input's field of view, f/8-sharp from foreground to skyline, accurate white balance, the faintest natural grain, cinematic but restrained colour grade. Magazine-cover architectural photography. No labels, no text, no logos, no watermarks.`;

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
