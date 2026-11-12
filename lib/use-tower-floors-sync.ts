"use client";
import { useEffect } from "react";
import { useProject, useStore } from "./store";
import { desiredResidentialFloors } from "./calc/scheme";

/**
 * Keeps the persisted residential tower floor count (typeFloors.count /
 * numFloors) equal to what Setup + Distribution imply. Mounted once at page
 * level, so editing the GFA in Setup updates Apartments, Parking, Lifts and
 * Massing without first visiting Distribution — and an office / retail
 * scheme with no residential use drops to zero residential floors.
 */
export function useTowerFloorsSync() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const desired = desiredResidentialFloors(project);
  const current = project.typeFloors?.count ?? project.numFloors;
  useEffect(() => {
    if (desired === null || desired === current) return;
    const heightM = project.typeFloors?.heightM ?? project.floorHeight;
    patch({
      typeFloors: { count: desired, heightM },
      numFloors: desired,
      floorHeight: heightM > 0 ? heightM : project.floorHeight,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desired, current, project.id]);
}
