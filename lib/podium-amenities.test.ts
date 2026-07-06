import { describe, it, expect } from "vitest";
import { rectanglePlotPolygon } from "./geom";
import { planPodiumAmenities } from "./podium-amenities";

describe("planPodiumAmenities", () => {
  it("places both pool and lounge on a wide deck ring", () => {
    // 60x50 podium, 30x20 centred tower -> a generous 15m ring on every side.
    const podium = rectanglePlotPolygon(60, 50);
    const tower = rectanglePlotPolygon(30, 20);
    const plan = planPodiumAmenities(podium, tower, { pool: true, lounge: true });
    expect(plan.pool).not.toBeNull();
    expect(plan.lounge).not.toBeNull();
    expect(plan.pool!.length).toBeGreaterThanOrEqual(8);
    expect(plan.pool!.width).toBeGreaterThanOrEqual(4);
    expect(plan.lounge!.length).toBeGreaterThanOrEqual(6);
  });

  it("returns null for both when the podium ring is too narrow", () => {
    // Tower nearly fills the podium footprint -> ring depth (1m) well under both minimums.
    const podium = rectanglePlotPolygon(40, 40);
    const tower = rectanglePlotPolygon(38, 38);
    const plan = planPodiumAmenities(podium, tower, { pool: true, lounge: true });
    expect(plan.pool).toBeNull();
    expect(plan.lounge).toBeNull();
  });

  it("skips only the pool when the ring is deep enough for the lounge but not the pool", () => {
    // Ring depth 4m: below the pool's 5m minimum, above the lounge's 3.5m minimum.
    const podium = rectanglePlotPolygon(60, 50);
    const tower = rectanglePlotPolygon(52, 42);
    const plan = planPodiumAmenities(podium, tower, { pool: true, lounge: true });
    expect(plan.pool).toBeNull();
    expect(plan.lounge).not.toBeNull();
  });

  it("places a pool on the full podium roof when there is no tower above", () => {
    const podium = rectanglePlotPolygon(40, 30);
    const plan = planPodiumAmenities(podium, [], { pool: true, lounge: false });
    expect(plan.pool).not.toBeNull();
    expect(plan.lounge).toBeNull();
  });

  it("returns nulls when neither amenity is requested", () => {
    const podium = rectanglePlotPolygon(60, 50);
    const tower = rectanglePlotPolygon(30, 20);
    const plan = planPodiumAmenities(podium, tower, { pool: false, lounge: false });
    expect(plan.pool).toBeNull();
    expect(plan.lounge).toBeNull();
  });
});
