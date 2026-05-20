import type { Point } from "./geom";

/** A 3D mass to be rendered. The polygon is the floor footprint; the volume
 *  extrudes vertically between `fromY` and `toY`. `kind` lets the renderer
 *  colour the tier (basement / ground / podium / tower) differently. */
export interface Volume {
  polygon: Point[];
  hole?: Point[];
  fromY: number;
  toY: number;
  kind?: "tower" | "ground" | "podium" | "basement";
}
