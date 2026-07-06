"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Project, Typology, ProgramCell, CommonArea, ParkingLevel, OtherUse } from "./types";
import { PRODUCTION_CITY_SAMPLE, emptyProject, newId } from "./sample";

/** localStorage wrapper that survives QuotaExceededError. The whole store is
 *  one key rewritten on every change; plan images (parcel.imageDataUrl) can be
 *  megabytes each, so with a few plans stored the browser quota gets hit and a
 *  plain setItem throws — zustand's persist swallows that, leaving disk state
 *  frozen mid-write-sequence. Symptom: an Apply that upserts N typologies looks
 *  fine in memory but only the writes before the quota hit survive a reload
 *  ("only Studio remains"). On quota failure we retry once with every plan
 *  image stripped: the numeric project data ALWAYS persists; the images are
 *  the sacrificial payload (UI offers a re-upload when one is missing). */
const resilientStorage = {
  getItem: (name: string) => (typeof window === "undefined" ? null : window.localStorage.getItem(name)),
  removeItem: (name: string) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      try {
        const parsed = JSON.parse(value) as { state?: { projects?: Record<string, Project> } };
        for (const p of Object.values(parsed.state?.projects ?? {})) {
          if (p.parcel?.imageDataUrl) p.parcel = { ...p.parcel, imageDataUrl: "" };
        }
        window.localStorage.setItem(name, JSON.stringify(parsed));
        console.warn(
          "qube: localStorage quota exceeded — project data saved, but plan images were dropped from local storage. Re-upload a plan drawing to see it again.",
        );
      } catch (e2) {
        console.error("qube: could not persist project data at all", e2);
      }
    }
  },
};

interface State {
  projects: Record<string, Project>;
  activeProjectId: string;

  /** Returns the currently active project; throws if none — guaranteed by initState */
  current: () => Project;

  // Multi-project management
  newProject: (name?: string) => string;
  loadSample: () => string;
  duplicateProject: (id: string, newName?: string) => string;
  deleteProject: (id: string) => void;
  switchProject: (id: string) => void;

  // Mutations on the active project
  setProject: (p: Project) => void;
  patch: (patch: Partial<Project>) => void;

  // Cloud sync
  /** Replace (or insert) a project keyed by its cloud uuid. Re-keys local ids
   *  when a project gets linked for the first time. */
  upsertFromCloud: (p: Project, opts?: { activate?: boolean }) => void;
  /** Remove a project by its cloud id (does nothing if not present locally). */
  removeByCloudId: (cloudId: string) => void;
  /** Mark the active local-only project as linked to a freshly created cloud row. */
  linkActiveToCloud: (cloudId: string) => void;

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

function freshSample(): Project {
  const now = Date.now();
  return { ...PRODUCTION_CITY_SAMPLE, id: newId("sample"), createdAt: now, updatedAt: now };
}

function initState(): { projects: Record<string, Project>; activeProjectId: string } {
  const sample = freshSample();
  return { projects: { [sample.id]: sample }, activeProjectId: sample.id };
}

/** Helper: update the active project immutably and bump updatedAt */
function updateActive(state: State, mutate: (p: Project) => Project): Partial<State> {
  const id = state.activeProjectId;
  const p = state.projects[id];
  if (!p) return {};
  const next = { ...mutate(p), updatedAt: Date.now() };
  return { projects: { ...state.projects, [id]: next } };
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initState(),

      current: () => {
        const { projects, activeProjectId } = get();
        return projects[activeProjectId] ?? freshSample();
      },

      newProject: (name = "Untitled Project") => {
        const p = emptyProject(name);
        set((s) => ({ projects: { ...s.projects, [p.id]: p }, activeProjectId: p.id }));
        return p.id;
      },

      loadSample: () => {
        const p = freshSample();
        p.name = "Production City — Sample";
        set((s) => ({ projects: { ...s.projects, [p.id]: p }, activeProjectId: p.id }));
        return p.id;
      },

      duplicateProject: (id, newName) => {
        const src = get().projects[id];
        if (!src) return id;
        const now = Date.now();
        const copy: Project = { ...src, id: newId(), name: newName ?? `${src.name} (copy)`, createdAt: now, updatedAt: now };
        set((s) => ({ projects: { ...s.projects, [copy.id]: copy }, activeProjectId: copy.id }));
        return copy.id;
      },

      deleteProject: (id) => {
        set((s) => {
          const next = { ...s.projects };
          delete next[id];
          if (Object.keys(next).length === 0) {
            const blank = emptyProject();
            return { projects: { [blank.id]: blank }, activeProjectId: blank.id };
          }
          let activeId = s.activeProjectId;
          if (activeId === id) {
            activeId = Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
          }
          return { projects: next, activeProjectId: activeId };
        });
      },

      switchProject: (id) => {
        if (!get().projects[id]) return;
        set({ activeProjectId: id });
      },


      setProject: (p) => set((s) => updateActive(s, () => p)),
      patch: (patch) => set((s) => updateActive(s, (p) => ({ ...p, ...patch }))),

      upsertFromCloud: (p, opts) => {
        const cloudId = p.cloudId ?? p.id;
        const incoming: Project = { ...p, id: cloudId, cloudId };
        set((s) => {
          const existing = s.projects[cloudId];
          // Don't clobber unsaved newer local edits.
          if (existing && existing.updatedAt > incoming.updatedAt) return {};
          const projects = { ...s.projects, [cloudId]: incoming };
          const activeProjectId = opts?.activate ? cloudId : s.activeProjectId;
          return { projects, activeProjectId };
        });
      },

      removeByCloudId: (cloudId) => {
        set((s) => {
          if (!s.projects[cloudId]) return {};
          const next = { ...s.projects };
          delete next[cloudId];
          if (Object.keys(next).length === 0) {
            const blank = emptyProject();
            return { projects: { [blank.id]: blank }, activeProjectId: blank.id };
          }
          let activeId = s.activeProjectId;
          if (activeId === cloudId) {
            activeId = Object.values(next).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
          }
          return { projects: next, activeProjectId: activeId };
        });
      },

      linkActiveToCloud: (cloudId) => {
        set((s) => {
          const oldId = s.activeProjectId;
          const p = s.projects[oldId];
          if (!p) return {};
          const linked: Project = { ...p, id: cloudId, cloudId, updatedAt: Date.now() };
          const next = { ...s.projects };
          delete next[oldId];
          next[cloudId] = linked;
          return { projects: next, activeProjectId: cloudId };
        });
      },

      upsertTypology: (t) =>
        set((s) =>
          updateActive(s, (p) => {
            const idx = p.typologies.findIndex((x) => x.id === t.id);
            const next = [...p.typologies];
            if (idx >= 0) next[idx] = t;
            else next.push(t);
            return { ...p, typologies: next };
          })
        ),
      removeTypology: (id) =>
        set((s) =>
          updateActive(s, (p) => ({
            ...p,
            typologies: p.typologies.filter((t) => t.id !== id),
            program: p.program.filter((c) => c.typologyId !== id),
          }))
        ),

      setProgramCell: (floor, typologyId, count) =>
        set((s) =>
          updateActive(s, (p) => {
            const next = p.program.filter((c) => !(c.floor === floor && c.typologyId === typologyId));
            if (count > 0) next.push({ floor, typologyId, count });
            return { ...p, program: next };
          })
        ),

      upsertCommonArea: (c) =>
        set((s) =>
          updateActive(s, (p) => {
            const idx = p.commonAreas.findIndex((x) => x.id === c.id);
            const next = [...p.commonAreas];
            if (idx >= 0) next[idx] = c;
            else next.push(c);
            return { ...p, commonAreas: next };
          })
        ),
      removeCommonArea: (id) =>
        set((s) => updateActive(s, (p) => ({ ...p, commonAreas: p.commonAreas.filter((c) => c.id !== id) }))),

      upsertParking: (pk) =>
        set((s) =>
          updateActive(s, (p) => {
            const idx = p.parking.findIndex((x) => x.id === pk.id);
            const next = [...p.parking];
            if (idx >= 0) next[idx] = pk;
            else next.push(pk);
            return { ...p, parking: next };
          })
        ),
      removeParking: (id) =>
        set((s) => updateActive(s, (p) => ({ ...p, parking: p.parking.filter((pk) => pk.id !== id) }))),

      upsertOtherUse: (u) =>
        set((s) =>
          updateActive(s, (p) => {
            const idx = p.otherUses.findIndex((x) => x.id === u.id);
            const next = [...p.otherUses];
            if (idx >= 0) next[idx] = u;
            else next.push(u);
            return { ...p, otherUses: next };
          })
        ),
      removeOtherUse: (id) =>
        set((s) => updateActive(s, (p) => ({ ...p, otherUses: p.otherUses.filter((u) => u.id !== id) }))),
    }),
    {
      name: "qube-plot-analysis",
      version: 2,
      storage: createJSONStorage(() => resilientStorage),
      migrate: (persisted: unknown, fromVersion: number) => {
        // v0/v1 shape: { project: Project (without id) }
        if (fromVersion < 2 && persisted && typeof persisted === "object" && "project" in persisted) {
          const old = (persisted as { project: Partial<Project> }).project;
          const now = Date.now();
          const id = newId();
          const migrated: Project = {
            ...PRODUCTION_CITY_SAMPLE,
            ...old,
            id,
            createdAt: now,
            updatedAt: now,
          };
          return { projects: { [id]: migrated }, activeProjectId: id };
        }
        return persisted as State;
      },
      // Only persist what we need (cast: the rest are functions, not data)
      partialize: (s) => ({ projects: s.projects, activeProjectId: s.activeProjectId } as unknown as State),
    }
  )
);

/** Convenience hook used by all tabs — guaranteed-non-null current project */
export function useProject(): Project {
  return useStore((s) => s.projects[s.activeProjectId]) ?? freshSample();
}
