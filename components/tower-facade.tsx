"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Point } from "@/lib/geom";
import { isCounterClockwise, polygonBBox, pointToPolygonDistance } from "@/lib/geom";
import { ACCENTS, GLASSES, type FacadeParams } from "@/lib/facade";
import type { TowerFacadeStyle } from "@/lib/types";
import { facadeGrid, filletPolygon, roofLayout, type Station } from "@/lib/facade-geometry";
import { Instanced, bandGeometry, boxAt, cellRand, grow, instancedObject, prismGeometry, yawOf } from "./scene-kit";

/*
 * Designed façades for the 3D massing: a Dubai residential tower (four
 * concepts, crown and rooftop sky pool), a glazed lobby with an entrance
 * canopy, and a podium with floor bands and an optional metal fin screen.
 * Geometry depends only on the shape and the design choices; colours are
 * resolved at render time, so switching glass or metal never rebuilds it.
 */

/* -------------------------------------------------------------------------- */
/*                                 Materials                                  */
/* -------------------------------------------------------------------------- */

export type FacadeMaterialKind = "model" | "real";

export type MatKey =
  | "glass"
  | "spandrel"
  | "slab"
  | "accent"
  | "frame"
  | "rail"
  | "deck"
  | "water"
  | "loungeGlass"
  | "lobbyGlass"
  | "glow"
  | "podiumVoid"
  | "podiumBody";

export interface MatProps {
  color: string;
  roughness: number;
  metalness?: number;
  opacity?: number;
  clearcoat?: number;
  emissive?: string;
  emissiveIntensity?: number;
  envMapIntensity?: number;
}

function shade(hex: string, k: number) {
  return `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
}

export function facadeMaterials(p: FacadeParams, kind: FacadeMaterialKind): Record<MatKey, MatProps> {
  const g = GLASSES[p.glass];
  const a = ACCENTS[p.accent];
  if (kind === "model") {
    return {
      glass: { color: g.model, roughness: 0.12, metalness: 0.2, clearcoat: 0.4, envMapIntensity: 0.9 },
      spandrel: { color: shade(g.model, 0.78), roughness: 0.3, metalness: 0.15 },
      slab: { color: "#f8f7f3", roughness: 0.75 },
      accent: { color: a.model, roughness: 0.7 },
      frame: { color: shade(a.model, 0.9), roughness: 0.7 },
      rail: { color: "#d6e3ea", roughness: 0.08, metalness: 0.1, opacity: 0.5 },
      deck: { color: "#ebe8e1", roughness: 0.9 },
      water: { color: "#b9dde9", roughness: 0.05, metalness: 0.1, clearcoat: 1 },
      loungeGlass: { color: shade(g.model, 0.8), roughness: 0.1, metalness: 0.2 },
      lobbyGlass: { color: g.model, roughness: 0.06, metalness: 0.2, opacity: 0.55 },
      glow: { color: "#f6f1e6", roughness: 1, emissive: "#f6f1e6", emissiveIntensity: 0.15 },
      podiumVoid: { color: "#d8dce1", roughness: 0.9 },
      podiumBody: { color: "#f1efea", roughness: 0.85 },
    };
  }
  return {
    glass: { color: g.real, roughness: 0.06, metalness: 0.35, clearcoat: 0.25, envMapIntensity: 1.1 },
    spandrel: { color: shade(g.real, 0.45), roughness: 0.12, metalness: 0.6, clearcoat: 0.6 },
    slab: { color: "#f1efe9", roughness: 0.55 },
    accent: { color: a.real, roughness: a.roughness, metalness: a.metalness, envMapIntensity: 1.2 },
    frame: { color: a.frame, roughness: 0.45, metalness: a.metalness * 0.8 },
    rail: { color: "#a9c3cf", roughness: 0.05, metalness: 0.2, opacity: 0.3 },
    deck: { color: "#cdbd9e", roughness: 0.85 },
    water: { color: "#2fb2cf", roughness: 0.03, metalness: 0.25, clearcoat: 1, envMapIntensity: 1.4 },
    loungeGlass: { color: shade(g.real, 0.55), roughness: 0.05, metalness: 0.6, clearcoat: 1 },
    lobbyGlass: { color: shade(g.real, 0.85), roughness: 0.04, metalness: 0.35, opacity: 0.5 },
    glow: { color: "#f3d9aa", roughness: 1, emissive: "#f6d7a0", emissiveIntensity: 0.45 },
    podiumVoid: { color: "#474c53", roughness: 0.9 },
    podiumBody: { color: "#e4ded1", roughness: 0.8 },
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Layers                                    */
/* -------------------------------------------------------------------------- */

interface Layer {
  mat: MatKey;
  matrices: THREE.Matrix4[];
  geometry?: THREE.BufferGeometry;
  colors?: THREE.Color[];
}

export class Layers {
  list: Layer[] = [];
  private owned: THREE.BufferGeometry[] = [];

  /** Unit boxes. */
  boxes(mat: MatKey, matrices: THREE.Matrix4[], colors?: THREE.Color[]) {
    if (matrices.length) this.list.push({ mat, matrices, colors });
  }

  /** A generated geometry placed at each of `ys`. */
  at(mat: MatKey, geometry: THREE.BufferGeometry | null, ys: number[]) {
    if (!geometry) return;
    this.owned.push(geometry);
    if (ys.length === 0) return;
    this.list.push({ mat, geometry, matrices: ys.map((y) => new THREE.Matrix4().makeTranslation(0, y, 0)) });
  }

  dispose() {
    this.owned.forEach((g) => g.dispose());
  }
}

function useLayers(build: () => Layers, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layers = useMemo(build, deps);
  useEffect(() => () => layers.dispose(), [layers]);
  return layers;
}

/** The layers as plain three.js objects (for renderers outside React). */
export function layersToObjects(layers: Layers, mats: Record<MatKey, MatProps>): THREE.Object3D[] {
  return layers.list.flatMap((l) => {
    const o = instancedObject({ matrices: l.matrices, geometry: l.geometry, colors: l.colors, ...mats[l.mat] });
    return o ? [o] : [];
  });
}

function RenderLayers({ layers, mats }: { layers: Layers; mats: Record<MatKey, MatProps> }) {
  return (
    <>
      {layers.list.map((l, i) => (
        <Instanced key={i} matrices={l.matrices} geometry={l.geometry} colors={l.colors} {...mats[l.mat]} />
      ))}
    </>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const range = (from: number, to: number) => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i));

/* -------------------------------------------------------------------------- */
/*                                   Tower                                    */
/* -------------------------------------------------------------------------- */

/** Curtain-wall line behind the façade line (m). */
const GLASS_INSET = 0.22;
const RAIL_H = 1.1;
const MODULE: Record<TowerFacadeStyle, number> = { balconies: 1.6, curtain: 1.5, fins: 1.8, frame: 1.6 };

/** The tower outline the façade is built on — corners rounded when asked. */
export function designOutline(polygon: Point[], rounded: boolean): Point[] {
  if (!rounded || polygon.length < 3) return polygon;
  const b = polygonBBox(polygon);
  return filletPolygon(polygon, clamp(Math.min(b.w, b.h) * 0.16, 2.5, 7));
}

/** Height of the crown screen above the roof slab for a given storey height. */
export function crownHeight(floorH: number) {
  return clamp(floorH * 2.6, 6, 13);
}

interface TowerProps {
  polygon: Point[];
  fromY: number;
  toY: number;
  floorHeight: number;
  floors?: number;
  params: FacadeParams;
  kind: FacadeMaterialKind;
}

export function TowerFacade({ polygon, fromY, toY, floorHeight, floors: floorsIn, params, kind }: TowerProps) {
  const { style, roundedCorners, crown, balconyDepthM } = params;
  const layers = useLayers(
    () => buildTower({ polygon, fromY, toY, floorHeight, floors: floorsIn, style, roundedCorners, crown, balconyDepthM }),
    [polygon, fromY, toY, floorHeight, floorsIn, style, roundedCorners, crown, balconyDepthM],
  );
  const mats = useMemo(() => facadeMaterials(params, kind), [params, kind]);
  return <RenderLayers layers={layers} mats={mats} />;
}

export function buildTower(o: {
  polygon: Point[];
  fromY: number;
  toY: number;
  floorHeight: number;
  floors?: number;
  style: TowerFacadeStyle;
  roundedCorners: boolean;
  crown: boolean;
  balconyDepthM: number;
}): Layers {
  const L = new Layers();
  const { fromY, toY, style } = o;
  const height = toY - fromY;
  if (o.polygon.length < 3 || height <= 0) return L;
  const floors = Math.max(1, o.floors ?? Math.round(height / Math.max(0.1, o.floorHeight)));
  const floorH = height / floors;
  const outline = designOutline(o.polygon, o.roundedCorners);
  const glassLine = grow(outline, -GLASS_INSET);
  const module = MODULE[style];
  const glassGrid = facadeGrid(glassLine, module);
  const at = (f: number, dy = 0) => fromY + f * floorH + dy;
  const inner = range(1, floors - 1);
  const fullMid = fromY + height / 2;

  // Vision glass: one pane per module and floor, each a touch lighter or
  // darker than the next the way a real curtain wall reads from afar.
  {
    const panes: THREE.Matrix4[] = [];
    const tones: THREE.Color[] = [];
    glassGrid.panels.forEach((p, i) => {
      const yaw = yawOf(p.ux, p.uy);
      for (let f = 0; f < floors; f++) {
        panes.push(boxAt(p.x, p.y, at(f, floorH / 2), yaw, p.len + 0.02, floorH, 0.06));
        const r = cellRand(17, i, f);
        const r2 = cellRand(17, i, f, 1);
        const k = 1 + (r - 0.5) * 0.14 - (r2 < 0.07 ? 0.18 : 0);
        tones.push(new THREE.Color(k, k, k * (1 + (r2 - 0.5) * 0.06)));
      }
    });
    L.boxes("glass", panes, tones);
  }

  /** Full-height members on the glass joints, projecting `depth` outward from the glass. */
  const verticals = (list: Station[], w: number, depth: (s: Station) => number) =>
    list.map((s) => {
      const d = depth(s);
      return boxAt(s.x + (s.nx * d) / 2, s.y + (s.ny * d) / 2, fullMid, yawOf(s.ux, s.uy), w, height, d);
    });
  const joints = glassGrid.stations;

  switch (style) {
    case "balconies": {
      const D = clamp(o.balconyDepthM, 0.8, 4);
      L.at("slab", bandGeometry(outline, D, -0.35, 0.26), inner.map((f) => at(f, -0.21)));
      L.at("rail", bandGeometry(outline, D - 0.05, D - 0.1, RAIL_H), inner.map((f) => at(f, 0.05)));
      L.at("accent", bandGeometry(outline, D - 0.02, D - 0.13, 0.07), inner.map((f) => at(f, 0.05 + RAIL_H)));
      // Privacy screens between apartments.
      const screens: THREE.Matrix4[] = [];
      for (const s of facadeGrid(outline, 7.2).stations) {
        if (s.corner) continue;
        for (const f of inner) {
          screens.push(boxAt(s.x + s.nx * (D / 2), s.y + s.ny * (D / 2), at(f, floorH / 2 - 0.08), yawOf(s.ux, s.uy), 0.12, floorH - 0.3, D - 0.12));
        }
      }
      L.boxes("slab", screens);
      L.boxes("frame", verticals(joints, 0.06, () => 0.12));
      break;
    }
    case "curtain": {
      L.at("spandrel", bandGeometry(outline, 0.03, -0.4, 0.95), inner.map((f) => at(f, -0.5)));
      const fin = (s: Station) => s.corner || s.k % 4 === 0;
      L.boxes("accent", verticals(joints.filter(fin), 0.16, () => 0.62));
      L.boxes("frame", verticals(joints.filter((s) => !fin(s)), 0.07, () => 0.18));
      break;
    }
    case "fins": {
      L.at("slab", bandGeometry(outline, 0.12, -0.4, 0.38), inner.map((f) => at(f, -0.19)));
      // Fin depth ripples round the tower in slow waves.
      const per = Math.max(1, glassGrid.perimeter);
      const waves = Math.max(2, Math.round(per / 26));
      L.boxes(
        "accent",
        verticals(joints, 0.2, (s) => (s.corner ? 1.05 : 0.45 + 0.6 * (0.5 + 0.5 * Math.sin((2 * Math.PI * waves * s.s) / per)))),
      );
      break;
    }
    case "frame": {
      L.at("frame", bandGeometry(outline, 0.04, -0.4, 0.2), inner.filter((f) => f % 2 === 1).map((f) => at(f, -0.1)));
      L.at("accent", bandGeometry(outline, 0.75, -0.4, 0.6), range(0, floors - 1).filter((f) => f % 2 === 0).map((f) => at(f, -0.3)));
      const post = (s: Station) => s.corner || s.k % 3 === 0;
      L.boxes("accent", verticals(joints.filter(post), 0.55, () => 0.97));
      L.boxes("frame", verticals(joints.filter((s) => !post(s)), 0.06, () => 0.14));
      break;
    }
  }

  // Roof slab and the edge band of the top floor.
  L.at("slab", prismGeometry(grow(outline, 0.05), null, 0.32), [toY - 0.32]);
  L.at(style === "frame" ? "accent" : "slab", bandGeometry(outline, style === "frame" ? 0.75 : 0.14, -0.5, 0.6), [toY - 0.6]);
  L.at("deck", prismGeometry(grow(outline, -0.95), null, 0.12), [toY]);

  const roof = roofLayout(outline);
  const deckY = toY + 0.12;
  if (o.crown) {
    const cH = crownHeight(floorH);
    // Crown screen: slender blades round the roof, capped by a ring — a lantern
    // that also hides the lift overrun and plant.
    const blades = facadeGrid(outline, style === "fins" || style === "frame" ? module : 1.2).stations.map((s) =>
      boxAt(s.x + s.nx * 0.12, s.y + s.ny * 0.12, toY + cH / 2, yawOf(s.ux, s.uy), 0.14, cH, 0.6),
    );
    L.boxes("accent", blades);
    L.at("accent", bandGeometry(outline, 0.5, -0.6, 0.5), [toY + cH - 0.5]);
    L.at("rail", bandGeometry(outline, -0.95, -1.01, RAIL_H), [deckY]);
    if (roof.pool) {
      const p = roof.pool;
      L.boxes("slab", [boxAt(p.x, p.y, deckY + 0.2, p.yaw, p.len + 0.9, 0.4, p.wid + 0.9)]);
      L.boxes("water", [boxAt(p.x, p.y, deckY + 0.42, p.yaw, p.len, 0.05, p.wid)]);
      // Sun loungers between the pool and the pavilion.
      const count = Math.floor(p.len / 1.6);
      const lounge: THREE.Matrix4[] = [];
      const off = -(p.wid / 2 + 1.7);
      for (let i = 0; i < count; i++) {
        const t = -p.len / 2 + 0.8 + i * 1.6;
        lounge.push(boxAt(p.x + p.ux * t + p.vx * off, p.y + p.uy * t + p.vy * off, deckY + 0.2, p.yaw, 0.7, 0.3, 1.9));
      }
      L.boxes("slab", lounge);
    }
    if (roof.core) {
      const c = roof.core;
      L.boxes("loungeGlass", [boxAt(c.x, c.y, deckY + 1.8, c.yaw, c.len, 3.6, c.wid)]);
      L.boxes("accent", [boxAt(c.x, c.y, deckY + 3.75, c.yaw, c.len + 1.4, 0.3, c.wid + 1.4)]);
    }
  } else {
    L.at("slab", bandGeometry(outline, 0.14, -0.3, 1.2), [toY - 0.08]);
    if (roof.core) {
      const c = roof.core;
      L.boxes("podiumBody", [boxAt(c.x, c.y, deckY + 1.6, c.yaw, c.len, 3.2, c.wid)]);
    }
  }
  return L;
}

/* -------------------------------------------------------------------------- */
/*                              Lobby & canopy                                */
/* -------------------------------------------------------------------------- */

export function LobbyFacade({
  polygon, fromY, toY, floors, plot, params, kind,
}: {
  polygon: Point[];
  fromY: number;
  toY: number;
  floors?: number;
  plot: Point[];
  params: FacadeParams;
  kind: FacadeMaterialKind;
}) {
  const layers = useLayers(() => buildLobby(polygon, fromY, toY, floors ?? 1, plot), [polygon, fromY, toY, floors, plot]);
  const mats = useMemo(() => facadeMaterials(params, kind), [params, kind]);
  return <RenderLayers layers={layers} mats={mats} />;
}

export function buildLobby(polygon: Point[], fromY: number, toY: number, floors: number, plot: Point[]): Layers {
  const L = new Layers();
  const h = toY - fromY;
  if (polygon.length < 3 || h <= 0) return L;
  const fasciaH = clamp(h * 0.2, 0.6, 1.2);
  const glassH = h - fasciaH;
  const glassLine = grow(polygon, -0.5);
  L.at("lobbyGlass", prismGeometry(glassLine, null, glassH), [fromY]);
  L.at("glow", prismGeometry(grow(polygon, -1.8), null, Math.max(0.5, glassH - 0.3)), [fromY]);
  L.boxes(
    "frame",
    facadeGrid(glassLine, 2.4).stations.map((s) =>
      boxAt(s.x + s.nx * 0.06, s.y + s.ny * 0.06, fromY + glassH / 2, yawOf(s.ux, s.uy), 0.1, glassH, 0.14),
    ),
  );
  if (floors > 1) {
    const fh = h / floors;
    L.at("slab", bandGeometry(polygon, 0.06, -0.8, 0.4), range(1, floors - 1).map((f) => fromY + f * fh - 0.2));
  }
  L.at("slab", bandGeometry(polygon, 0.1, -0.8, fasciaH), [toY - fasciaH]);
  L.at("slab", prismGeometry(grow(polygon, -0.7), null, 0.3), [toY - 0.3]);

  // Drop-off canopy on the edge facing the street front (plan −y).
  const n = polygon.length;
  const outSign = isCounterClockwise(polygon) ? 1 : -1;
  let best = -1;
  let front: { mx: number; my: number; ux: number; uy: number; nx: number; ny: number; len: number } | null = null;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 6) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = uy * outSign;
    const ny = -ux * outSign;
    const score = len * Math.max(0, -ny);
    if (score > best) {
      best = score;
      front = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ux, uy, nx, ny, len };
    }
  }
  if (front && best > 0) {
    const setback = plot.length >= 3 ? pointToPolygonDistance({ x: front.mx, y: front.my }, plot) : 3;
    const depth = clamp(setback + 2.5, 3, 6.5);
    const len = clamp(front.len * 0.42, 6, 16);
    const y = fromY + clamp(glassH - 0.6, 3, 5.4);
    const yaw = yawOf(front.ux, front.uy);
    const cx = front.mx + front.nx * (depth / 2);
    const cy = front.my + front.ny * (depth / 2);
    L.boxes("accent", [boxAt(cx, cy, y + 0.2, yaw, len, 0.4, depth)]);
    const posts: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      const px = front.mx + front.nx * (depth - 0.5) + front.ux * side * (len / 2 - 0.6);
      const py = front.my + front.ny * (depth - 0.5) + front.uy * side * (len / 2 - 0.6);
      posts.push(boxAt(px, py, fromY + (y - fromY) / 2, yaw, 0.3, y - fromY, 0.3));
    }
    L.boxes("frame", posts);
  }
  return L;
}

/* -------------------------------------------------------------------------- */
/*                                  Podium                                    */
/* -------------------------------------------------------------------------- */

export function PodiumFacade({
  polygon, fromY, toY, floors, params, kind,
}: {
  polygon: Point[];
  fromY: number;
  toY: number;
  floors?: number;
  params: FacadeParams;
  kind: FacadeMaterialKind;
}) {
  const { groundPodiumTreatment, finSpacingM, finWidthM, finDepthM } = params;
  const layers = useLayers(
    () => buildPodium(polygon, fromY, toY, floors, groundPodiumTreatment === "fins", finSpacingM, finWidthM, finDepthM),
    [polygon, fromY, toY, floors, groundPodiumTreatment, finSpacingM, finWidthM, finDepthM],
  );
  const mats = useMemo(() => facadeMaterials(params, kind), [params, kind]);
  return <RenderLayers layers={layers} mats={mats} />;
}

export function buildPodium(
  polygon: Point[], fromY: number, toY: number, floorsIn: number | undefined,
  fins: boolean, spacing: number, width: number, depth: number,
): Layers {
  const L = new Layers();
  const h = toY - fromY;
  if (polygon.length < 3 || h <= 0) return L;
  const floors = Math.max(1, floorsIn ?? Math.round(h / 3.5));
  const fh = h / floors;
  L.at(fins ? "podiumVoid" : "podiumBody", prismGeometry(grow(polygon, -0.15), null, h - 0.35), [fromY]);
  L.at("slab", bandGeometry(polygon, 0.12, -0.4, 0.5), range(1, floors - 1).map((f) => fromY + f * fh - 0.25));
  // Amenity deck on the roof, edged by a low parapet.
  L.at("deck", prismGeometry(grow(polygon, -0.1), null, 0.35), [toY - 0.35]);
  L.at("slab", bandGeometry(polygon, 0.12, -0.4, 1.3), [toY - 0.5]);
  if (fins) {
    const d = Math.max(0.05, depth);
    L.boxes(
      "accent",
      facadeGrid(polygon, Math.max(0.3, spacing)).stations.map((s) =>
        boxAt(s.x + s.nx * (d / 2 + 0.02), s.y + s.ny * (d / 2 + 0.02), fromY + (h - 0.5) / 2, yawOf(s.ux, s.uy), Math.max(0.03, width), h - 0.5, d),
      ),
    );
  }
  return L;
}
