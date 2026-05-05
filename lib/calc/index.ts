import type { Project } from "../types";
import { computeProgram, type ProgramResult } from "./program";
import { computeParking, type ParkingResult } from "./parking";
import { computeLifts, type LiftsResult } from "./lifts";
import { computeGarbage, type GarbageResult } from "./garbage";

export interface AnalysisResult {
  program: ProgramResult;
  parking: ParkingResult;
  lifts: LiftsResult;
  garbage: GarbageResult;
}

export function analyze(project: Project): AnalysisResult {
  return {
    program: computeProgram(project),
    parking: computeParking(project),
    lifts: computeLifts(project),
    garbage: computeGarbage(project),
  };
}

export { computeProgram, computeParking, computeLifts, computeGarbage };
