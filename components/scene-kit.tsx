"use client";
import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import type { Point } from "@/lib/geom";
import { isCounterClockwise, offsetPolygon } from "@/lib/geom";

/* Plan (x, y) maps to world (x, height, -y) everywhere in the 3D scene. */

export function polyToShape(points: Point[]): THREE.Shape | null {
  if (points.length < 3) return null;
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].y);
  s.closePath();
  return s;
}

/**
 * Vertical prism of a plan outline (optionally with a hole), baked into world
 * orientation and spanning y ∈ [0, height]. The outline is made
 * counter-clockwise so three.js also normalises the hole's winding.
 */
export function prismGeometry(outline: Point[], hole: Point[] | null, height: number): THREE.BufferGeometry | null {
  if (outline.length < 3 || height <= 0) return null;
  const outer = isCounterClockwise(outline) ? outline : outline.slice().reverse();
  const s = polyToShape(outer);
  if (!s) return null;
  if (hole && hole.length >= 3) {
    const path = new THREE.Path();
    path.moveTo(hole[0].x, hole[0].y);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
    path.closePath();
    s.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Outline grown outward by `d` metres (negative `d` shrinks it). */
export function grow(outline: Point[], d: number): Point[] {
  if (Math.abs(d) < 1e-6) return outline;
  const r = offsetPolygon(outline, -d);
  return r.length >= 3 ? r : outline;
}

/**
 * Horizontal band hugging an outline — the ring between the outline grown by
 * `outer` and grown by `inner` metres (negative = inside the façade line) —
 * `height` tall, y ∈ [0, height].
 */
export function bandGeometry(outline: Point[], outer: number, inner: number, height: number) {
  const o = grow(outline, outer);
  const i = offsetPolygon(outline, -inner);
  return prismGeometry(o, i.length >= 3 ? i : null, height);
}

/** Deterministic per-cell hash → [0,1). Stable across renders for a given seed. */
export function cellRand(seed: number, i: number, j: number, salt = 0): number {
  let h = (seed | 0) ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(j + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Transform of a unit box centred on plan point (x, y) at height `yMid`, turned by `yaw`. */
export function boxAt(x: number, y: number, yMid: number, yaw: number, sx: number, sy: number, sz: number) {
  _p.set(x, yMid, -y);
  _q.setFromAxisAngle(Y_AXIS, yaw);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/** Yaw that aligns a box's local X with plan direction (ux, uy). */
export const yawOf = (ux: number, uy: number) => Math.atan2(uy, ux);

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export interface InstancedProps {
  matrices: THREE.Matrix4[];
  /** Defaults to a unit box. Never disposed here — the owner disposes it. */
  geometry?: THREE.BufferGeometry;
  /** Per-instance colours (multiplied by `color`). */
  colors?: THREE.Color[];
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  clearcoat?: number;
  emissive?: string;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  flat?: boolean;
  doubleSide?: boolean;
  castShadow?: boolean;
}

/** One draw call for many copies of a geometry. */
export function Instanced({
  matrices, geometry, colors, color = "#ffffff", roughness = 0.8, metalness = 0, opacity = 1, clearcoat = 0,
  emissive, emissiveIntensity = 0, envMapIntensity = 1, flat = false, doubleSide = false, castShadow = true,
}: InstancedProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    colors?.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, colors]);
  if (matrices.length === 0) return null;
  const transparent = opacity < 1;
  const common = {
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: !transparent,
    emissive: emissive ?? "#000000",
    emissiveIntensity,
    envMapIntensity,
    flatShading: flat,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  };
  return (
    <instancedMesh
      // Instance colours are compiled into the shader, so a change remounts.
      key={`${matrices.length}-${colors ? "c" : "n"}`}
      ref={ref}
      args={[geometry ?? UNIT_BOX, undefined, matrices.length]}
      castShadow={castShadow && !transparent}
      receiveShadow
    >
      {clearcoat > 0 ? (
        <meshPhysicalMaterial {...common} clearcoat={clearcoat} clearcoatRoughness={0.12} />
      ) : (
        <meshStandardMaterial {...common} />
      )}
    </instancedMesh>
  );
}

/** The same instanced mesh as `Instanced`, built outside React (for other renderers). */
export function instancedObject({
  matrices, geometry, colors, color = "#ffffff", roughness = 0.8, metalness = 0, opacity = 1, clearcoat = 0,
  emissive, emissiveIntensity = 0, envMapIntensity = 1, flat = false, doubleSide = false,
}: InstancedProps): THREE.InstancedMesh | null {
  if (matrices.length === 0) return null;
  const transparent = opacity < 1;
  const common = {
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: !transparent,
    emissive: emissive ?? "#000000",
    emissiveIntensity,
    envMapIntensity,
    flatShading: flat,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  };
  const material =
    clearcoat > 0
      ? new THREE.MeshPhysicalMaterial({ ...common, clearcoat, clearcoatRoughness: 0.12 })
      : new THREE.MeshStandardMaterial(common);
  const mesh = new THREE.InstancedMesh(geometry ?? UNIT_BOX, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  colors?.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
