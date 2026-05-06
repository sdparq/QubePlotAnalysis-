import type { Project } from "../types";
import { DUBAI_STANDARDS } from "../standards/dubai";
import { computeProgram } from "./program";

export interface GarbageResult {
  residentialGFA: number;
  // Inputs in effect (with overrides applied)
  generationKgPer100sqmPerDay: number;
  storageDays: number;
  densityKgPerM3: number;
  containerCapacityM3: number;
  containerWidthM: number;
  containerLengthM: number;
  separationM: number;
  frontClearanceM: number;
  // Outputs
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
  const o = project.garbage ?? {};

  const generationKgPer100sqmPerDay = o.generationKgPer100sqmPerDay ?? w.generationKgPer100sqmPerDay;
  const storageDays = o.storageDays ?? w.storageDays;
  const densityKgPerM3 = o.densityKgPerM3 ?? w.densityKgPerM3;
  const containerCapacityM3 = o.containerCapacityM3 ?? w.container.capacityM3;
  const containerWidthM = o.containerWidthM ?? w.container.widthM;
  const containerLengthM = o.containerLengthM ?? w.container.lengthM;
  const separationM = o.separationM ?? w.separationM;
  const frontClearanceM = o.frontClearanceM ?? w.frontClearanceM;

  const residentialGFA = program.totalInteriorGFA;
  const dailyWasteKg = r2((residentialGFA * generationKgPer100sqmPerDay) / 100);
  const storageKg = r2(dailyWasteKg * storageDays);
  const volumeRequiredM3 = r2(storageKg / densityKgPerM3);
  const containers = volumeRequiredM3 === 0 ? 0 : Math.ceil(volumeRequiredM3 / containerCapacityM3);
  const roomWidthM =
    containers === 0 ? 0 : r2(containers * containerWidthM + (containers + 1) * separationM);
  const roomDepthM = r2(containerLengthM + frontClearanceM);
  const roomAreaM2 = r2(roomWidthM * roomDepthM);

  return {
    residentialGFA,
    generationKgPer100sqmPerDay,
    storageDays,
    densityKgPerM3,
    containerCapacityM3,
    containerWidthM,
    containerLengthM,
    separationM,
    frontClearanceM,
    dailyWasteKg,
    storageKg,
    volumeRequiredM3,
    containers,
    roomWidthM,
    roomDepthM,
    roomAreaM2,
  };
}
