import type { Project } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";
import { computeProgram } from "./program";

export interface GarbageResult {
  residentialGFA: number;
  dailyWasteKg: number;
  storageKg: number;
  volumeRequiredM3: number;
  containers: number;
  roomWidthM: number;
  roomDepthM: number;
  roomAreaM2: number;
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

export function computeGarbage(project: Project): GarbageResult {
  const program = computeProgram(project);
  const w = DUBAI_STANDARDS.waste;

  const residentialGFA = program.totalInteriorGFA;
  const dailyWasteKg = r2((residentialGFA * w.generationKgPer100sqmPerDay) / 100);
  const storageKg = r2(dailyWasteKg * w.storageDays);
  const volumeRequiredM3 = r2(storageKg / w.densityKgPerM3);
  const containers = volumeRequiredM3 === 0 ? 0 : Math.ceil(volumeRequiredM3 / w.container.capacityM3);
  const roomWidthM =
    containers === 0 ? 0 : r2(containers * w.container.widthM + (containers + 1) * w.separationM);
  const roomDepthM = r2(w.container.lengthM + w.frontClearanceM);
  const roomAreaM2 = r2(roomWidthM * roomDepthM);

  return {
    residentialGFA,
    dailyWasteKg,
    storageKg,
    volumeRequiredM3,
    containers,
    roomWidthM,
    roomDepthM,
    roomAreaM2,
  };
}
