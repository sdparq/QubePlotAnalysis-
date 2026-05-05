"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project, Typology, ProgramCell, CommonArea, ParkingLevel, OtherUse } from "./types";
import { PRODUCTION_CITY_SAMPLE, emptyProject } from "./sample";

interface State {
  project: Project;
  setProject: (p: Project) => void;
  patch: (p: Partial<Project>) => void;
  loadSample: () => void;
  reset: () => void;

  upsertTypology: (t: Typology) => void;
  removeTypology: (id: string) => void;

  setProgramCell: (floor: number, typologyId: string, count: number) => void;

  upsertCommonArea: (c: CommonArea) => void;
  removeCommonArea: (id: string) => void;

  upsertParking: (p: ParkingLevel) => void;
  removeParking: (id: string) => void;

  upsertOtherUse: (u: OtherUse) => void;
  removeOtherUse: (id: string) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      project: PRODUCTION_CITY_SAMPLE,
      setProject: (p) => set({ project: p }),
      patch: (p) => set((s) => ({ project: { ...s.project, ...p } })),
      loadSample: () => set({ project: PRODUCTION_CITY_SAMPLE }),
      reset: () => set({ project: emptyProject() }),

      upsertTypology: (t) =>
        set((s) => {
          const idx = s.project.typologies.findIndex((x) => x.id === t.id);
          const next = [...s.project.typologies];
          if (idx >= 0) next[idx] = t;
          else next.push(t);
          return { project: { ...s.project, typologies: next } };
        }),
      removeTypology: (id) =>
        set((s) => ({
          project: {
            ...s.project,
            typologies: s.project.typologies.filter((t) => t.id !== id),
            program: s.project.program.filter((c) => c.typologyId !== id),
          },
        })),

      setProgramCell: (floor, typologyId, count) =>
        set((s) => {
          const next = s.project.program.filter((c) => !(c.floor === floor && c.typologyId === typologyId));
          if (count > 0) next.push({ floor, typologyId, count });
          return { project: { ...s.project, program: next } };
        }),

      upsertCommonArea: (c) =>
        set((s) => {
          const idx = s.project.commonAreas.findIndex((x) => x.id === c.id);
          const next = [...s.project.commonAreas];
          if (idx >= 0) next[idx] = c;
          else next.push(c);
          return { project: { ...s.project, commonAreas: next } };
        }),
      removeCommonArea: (id) =>
        set((s) => ({ project: { ...s.project, commonAreas: s.project.commonAreas.filter((c) => c.id !== id) } })),

      upsertParking: (p) =>
        set((s) => {
          const idx = s.project.parking.findIndex((x) => x.id === p.id);
          const next = [...s.project.parking];
          if (idx >= 0) next[idx] = p;
          else next.push(p);
          return { project: { ...s.project, parking: next } };
        }),
      removeParking: (id) =>
        set((s) => ({ project: { ...s.project, parking: s.project.parking.filter((p) => p.id !== id) } })),

      upsertOtherUse: (u) =>
        set((s) => {
          const idx = s.project.otherUses.findIndex((x) => x.id === u.id);
          const next = [...s.project.otherUses];
          if (idx >= 0) next[idx] = u;
          else next.push(u);
          return { project: { ...s.project, otherUses: next } };
        }),
      removeOtherUse: (id) =>
        set((s) => ({ project: { ...s.project, otherUses: s.project.otherUses.filter((u) => u.id !== id) } })),
    }),
    { name: "qube-plot-analysis-v1" }
  )
);
