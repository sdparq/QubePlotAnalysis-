import type { Project } from "../types";
import { computeProgram, type ProgramResult } from "./program";
import { computeParking, type ParkingResult } from "./parking";
import { computeLifts, type LiftsResult } from "./lifts";

export interface AnalysisResult {
  program: ProgramResult;
  parking: ParkingResult;
  lifts: LiftsResult;
}

export function analyze(project: Project): AnalysisResult {
  return {
    program: computeProgram(project),
    parking: computeParking(project),
    lifts: computeLifts(project),
  };
}

export { computeProgram, computeParking, computeLifts };
