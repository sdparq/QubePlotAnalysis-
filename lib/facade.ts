import type { FacadeAccent, FacadeConfig, FacadeGlass, TowerFacadeStyle } from "./types";

/** Façade settings with every default applied — what the 3D scene renders. */
export interface FacadeParams {
  mode: "massing" | "residential";
  style: TowerFacadeStyle;
  glass: FacadeGlass;
  accent: FacadeAccent;
  roundedCorners: boolean;
  crown: boolean;
  entrance: boolean;
  balconyDepthM: number;
  groundPodiumTreatment: "massing" | "fins";
  finSpacingM: number;
  finWidthM: number;
  finDepthM: number;
  podiumPool: boolean;
  podiumLoungeBbq: boolean;
}

export function resolveFacade(f: FacadeConfig | undefined): FacadeParams {
  return {
    mode: f?.mode ?? "residential",
    style: f?.style ?? "balconies",
    glass: f?.glass ?? "azure",
    accent: f?.accent ?? "champagne",
    roundedCorners: f?.roundedCorners ?? true,
    crown: f?.crown ?? true,
    entrance: f?.entrance ?? true,
    balconyDepthM: f?.balconyDepthM ?? 2.2,
    groundPodiumTreatment: f?.groundPodiumTreatment ?? "fins",
    finSpacingM: f?.finSpacingM ?? 0.9,
    finWidthM: f?.finWidthM ?? 0.14,
    finDepthM: f?.finDepthM ?? 0.45,
    podiumPool: f?.podiumPool ?? false,
    podiumLoungeBbq: f?.podiumLoungeBbq ?? false,
  };
}

export const FACADE_STYLES: { id: TowerFacadeStyle; label: string; hint: string }[] = [
  { id: "balconies", label: "Resort balconies", hint: "Wraparound balconies, glass balustrades" },
  { id: "curtain", label: "Glass curtain wall", hint: "Floor-to-ceiling glazing, slim fins" },
  { id: "fins", label: "Vertical fins", hint: "Rippling full-height metal fins" },
  { id: "frame", label: "Framed grid", hint: "Double-height architectural frame" },
];

/** Glass tints — `real` feeds the Realistic style, `model` the white model. */
export const GLASSES: Record<FacadeGlass, { label: string; real: string; model: string; swatch: string }> = {
  azure: { label: "Azure", real: "#35658f", model: "#adc3d6", swatch: "#5b8db8" },
  aqua: { label: "Aqua", real: "#2f6f6c", model: "#abcbc8", swatch: "#5a9e9a" },
  grey: { label: "Grey", real: "#5c6874", model: "#bac1c8", swatch: "#6f7a85" },
  bronze: { label: "Bronze", real: "#65503d", model: "#c9bcae", swatch: "#8c735c" },
};

export const ACCENTS: Record<
  FacadeAccent,
  { label: string; real: string; frame: string; metalness: number; roughness: number; model: string; swatch: string }
> = {
  white: { label: "White", real: "#eeede8", frame: "#d4d6d8", metalness: 0.05, roughness: 0.5, model: "#f7f6f2", swatch: "#f4f3ee" },
  champagne: { label: "Champagne", real: "#d8c396", frame: "#b3a27f", metalness: 0.55, roughness: 0.3, model: "#ece3d0", swatch: "#cdb68a" },
  bronze: { label: "Bronze", real: "#8a6443", frame: "#6f5946", metalness: 0.55, roughness: 0.34, model: "#dfd2c3", swatch: "#86623f" },
  graphite: { label: "Graphite", real: "#3a3e44", frame: "#4b5057", metalness: 0.6, roughness: 0.4, model: "#caced3", swatch: "#41464d" },
};
