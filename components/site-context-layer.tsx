"use client";
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Point } from "@/lib/geom";
import { ccw, planToLocal, standsOnPlot, type ContextBuilding, type SiteContext } from "@/lib/site-context";
import { polyToShape } from "./scene-kit";
import { polygonCentroid } from "@/lib/geom";

/** Colours of the surroundings for one viewer style. */
export interface ContextLook {
  building: string;
  edge: string | null;
  road: string;
  water: string;
}

/*
 * The plot's real surroundings (OpenStreetMap): neighbouring buildings as
 * plain volumes, streets and water. Geometry is built in local east/north
 * metres and the whole layer is placed by one transform — the plot centroid
 * on the location, turned by true north — so dragging the north angle only
 * moves a group. Buildings standing on the plot are left out.
 */
/** World-space box of the scheme — neighbours standing in front of it are seen through. */
export interface FocusBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
}

export const SiteContextLayer = memo(function SiteContextLayer({
  context, plot, centroid, northDeg, look, focus,
}: {
  context: SiteContext;
  plot: Point[];
  centroid: Point;
  northDeg: number;
  look: ContextLook;
  focus: FocusBox;
}) {
  const xray = useXray(focus);
  const buildingMaterial = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.92, transparent: true });
    xray.apply(m);
    return m;
  }, [xray]);
  const edgeMaterial = useMemo(() => {
    const m = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 });
    xray.apply(m);
    return m;
  }, [xray]);
  useEffect(() => () => (buildingMaterial.dispose(), edgeMaterial.dispose(), undefined), [buildingMaterial, edgeMaterial]);
  useLayoutEffect(() => {
    buildingMaterial.color.set(look.building);
    if (look.edge) edgeMaterial.color.set(look.edge);
  }, [buildingMaterial, edgeMaterial, look]);

  // One geometry per building, built once per download.
  const pieces = useMemo(() => context.buildings.map(buildingPiece), [context]);
  useEffect(() => () => pieces.forEach((p) => p && (p.solid.dispose(), p.edges.dispose())), [pieces]);

  // Which buildings stand on the plot depends on where the plot is turned —
  // recomputed a beat later while the north angle is being dragged.
  const north = useDeferredValue(northDeg);
  const keep = useMemo(() => {
    const plotLocal = plot.map((p) => planToLocal(p, centroid, north));
    return context.buildings.map((b) => !standsOnPlot(b, plotLocal));
  }, [context, plot, centroid, north]);

  const { solid, edges } = useMemo(() => {
    const kept = pieces.filter((p, i) => p && keep[i]) as Piece[];
    if (kept.length === 0) return { solid: null, edges: null };
    return {
      solid: mergeGeometries(kept.map((p) => p.solid)) ?? null,
      edges: mergeGeometries(kept.map((p) => p.edges)) ?? null,
    };
  }, [pieces, keep]);
  useEffect(() => () => (solid?.dispose(), edges?.dispose(), undefined), [solid, edges]);

  const roads = useMemo(() => roadGeometry(context), [context]);
  const water = useMemo(() => waterGeometry(context), [context]);
  useEffect(() => () => (roads?.dispose(), water?.dispose(), undefined), [roads, water]);

  return (
    <group position={[centroid.x, 0, -centroid.y]} rotation={[0, (-northDeg * Math.PI) / 180, 0]}>
      {water && (
        <mesh geometry={water} position={[0, 0.002, 0]} receiveShadow>
          <meshStandardMaterial color={look.water} roughness={0.12} metalness={0.15} side={THREE.DoubleSide} />
        </mesh>
      )}
      {roads && (
        <mesh geometry={roads} position={[0, 0.005, 0]} receiveShadow>
          <meshStandardMaterial color={look.road} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
      {solid && <mesh geometry={solid} material={buildingMaterial} castShadow receiveShadow />}
      {edges && look.edge && <lineSegments geometry={edges} material={edgeMaterial} />}
    </group>
  );
});

/**
 * "X-ray" for neighbours in front of the scheme: fragments that fall inside
 * the scheme's screen footprint and are nearer to the camera than it fade to
 * a ghost, so a dense block never hides the tower being studied. Works in
 * clip space, so supersampled captures fade exactly like the screen.
 */
function useXray(focus: FocusBox) {
  const uniforms = useMemo(
    () => ({
      uXrayRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uXrayDepth: { value: -2 },
    }),
    [],
  );
  const corners = useMemo(() => {
    const m = 2;
    const out: THREE.Vector3[] = [];
    for (const x of [focus.minX - m, focus.maxX + m])
      for (const z of [focus.minZ - m, focus.maxZ + m])
        for (const y of [0, focus.topY + m]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }, [focus.minX, focus.maxX, focus.minZ, focus.maxZ, focus.topY]);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity;
    for (const c of corners) {
      v.copy(c).applyMatrix4(camera.matrixWorldInverse);
      if (v.z > -0.5) {
        // A corner behind the camera: no sensible footprint, fade nothing.
        uniforms.uXrayDepth.value = -2;
        return;
      }
      v.applyMatrix4(camera.projectionMatrix);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      z0 = Math.min(z0, v.z);
    }
    uniforms.uXrayRect.value.set(x0, y0, x1, y1);
    uniforms.uXrayDepth.value = z0;
  });

  return useMemo(
    () => ({
      apply(material: THREE.Material) {
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uXrayRect = uniforms.uXrayRect;
          shader.uniforms.uXrayDepth = uniforms.uXrayDepth;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec4 vXrayClip;")
            .replace("#include <project_vertex>", "#include <project_vertex>\nvXrayClip = gl_Position;");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec4 vXrayClip;\nuniform vec4 uXrayRect;\nuniform float uXrayDepth;")
            .replace(
              "#include <dithering_fragment>",
              `#include <dithering_fragment>
              {
                vec3 ndc = vXrayClip.xyz / vXrayClip.w;
                float edge = min(min(ndc.x - uXrayRect.x, uXrayRect.z - ndc.x), min(ndc.y - uXrayRect.y, uXrayRect.w - ndc.y));
                float inside = smoothstep(0.0, 0.06, edge) * step(ndc.z, uXrayDepth);
                gl_FragColor.a *= mix(1.0, 0.16, inside);
              }`,
            );
        };
        material.customProgramCacheKey = () => "context-xray";
      },
    }),
    [uniforms],
  );
}

interface Piece {
  solid: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
}

/** Extruded building (local metres → world), without UVs so every piece merges. */
function buildingPiece(b: ContextBuilding): Piece | null {
  const shape = polyToShape(ccw(b.outer));
  if (!shape) return null;
  for (const h of b.holes) {
    if (h.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(h[0].x, h[0].y);
    for (let i = 1; i < h.length; i++) path.lineTo(h[i].x, h[i].y);
    path.closePath();
    shape.holes.push(path);
  }
  const solid = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.5, b.top - b.base), bevelEnabled: false, curveSegments: 1 });
  solid.rotateX(-Math.PI / 2);
  solid.translate(0, b.base, 0);
  solid.deleteAttribute("uv");
  const edges = new THREE.EdgesGeometry(solid, 30);
  return { solid, edges };
}

/** Street ribbons: a quad per segment and a round joint at every vertex. */
function roadGeometry(ctx: SiteContext): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    pos.push(ax, 0, -ay, bx, 0, -by, cx, 0, -cy);
  const JOINT = 10;
  for (const r of ctx.roads) {
    const h = r.width / 2;
    const pts = r.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-3) continue;
      const nx = (-(b.y - a.y) / len) * h;
      const ny = ((b.x - a.x) / len) * h;
      tri(a.x + nx, a.y + ny, a.x - nx, a.y - ny, b.x - nx, b.y - ny);
      tri(a.x + nx, a.y + ny, b.x - nx, b.y - ny, b.x + nx, b.y + ny);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      const c = pts[i];
      for (let k = 0; k < JOINT; k++) {
        const a0 = (k / JOINT) * Math.PI * 2;
        const a1 = ((k + 1) / JOINT) * Math.PI * 2;
        tri(c.x, c.y, c.x + Math.cos(a0) * h, c.y + Math.sin(a0) * h, c.x + Math.cos(a1) * h, c.y + Math.sin(a1) * h);
      }
    }
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Flat water areas (canal, lagoons, basins). */
function waterGeometry(ctx: SiteContext): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const w of ctx.water) {
    const shape = polyToShape(ccw(w.outer));
    if (!shape) continue;
    for (const h of w.holes) {
      if (h.length < 3) continue;
      const path = new THREE.Path();
      path.moveTo(h[0].x, h[0].y);
      for (let i = 1; i < h.length; i++) path.lineTo(h[i].x, h[i].y);
      path.closePath();
      shape.holes.push(path);
    }
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute("uv");
    parts.push(g);
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  parts.forEach((g) => g.dispose());
  return merged ?? null;
}

/** Tallest building within `radius` metres of the plot — sizes the sun's shadow camera. */
export function contextTopWithin(ctx: SiteContext, radius: number): number {
  let top = 0;
  for (const b of ctx.buildings) {
    const c = polygonCentroid(b.outer);
    if (Math.hypot(c.x, c.y) <= radius) top = Math.max(top, b.top);
  }
  return top;
}
