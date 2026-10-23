import type { Project } from "./types";
import type { ZoneClass, ZoneClassRow } from "./zone-classes";
import { emptyProject } from "./sample";

/**
 * Project files — share a project with someone outside the team cloud.
 *
 * The file is the whole project as stored (plan image, traces, typologies,
 * Apartments matrix, façade…) plus the author's Class Library, so the
 * recipient's copy reads exactly as designed even when their own library
 * differs. Importing always creates a NEW local project: it never touches
 * the author's cloud row.
 */

export const PROJECT_FILE_FORMAT = "qube-plot-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXT = ".qube.json";

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: number;
  exportedAt: string;
  project: Project;
  classLibrary?: Record<ZoneClass, ZoneClassRow>;
}

export function buildProjectFile(project: Project, library: Record<ZoneClass, ZoneClassRow>): string {
  // The cloud link belongs to the author's team; the classLibrary of a
  // previously imported project is superseded by the library sent alongside.
  const { cloudId: _cloudId, classLibrary: _snapshot, ...rest } = project;
  void _cloudId;
  void _snapshot;
  const file: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    project: rest as Project,
    classLibrary: library,
  };
  return JSON.stringify(file);
}

export function projectFileName(name: string): string {
  const base =
    (name || "project")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "project";
  return `${base}${PROJECT_FILE_EXT}`;
}

export type ParsedProjectFile =
  | { ok: true; project: Project; classLibrary?: Record<string, unknown> }
  | { ok: false; error: string };

/** Validates a file's text and returns a project ready to import (fresh id,
 *  no cloud link, defaults filled for any field the author's version lacked). */
export function parseProjectFile(text: string): ParsedProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a QUBE project (it isn't valid JSON)." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "This file is not a QUBE project." };
  const f = raw as Partial<ProjectFile>;
  if (f.format !== PROJECT_FILE_FORMAT || !f.project || typeof f.project !== "object") {
    return { ok: false, error: "This file is not a QUBE project — export one from Projects → Export." };
  }
  if ((f.version ?? 0) > PROJECT_FILE_VERSION) {
    return { ok: false, error: "This project was exported by a newer version of the app — reload the page (Ctrl+Shift+R) and try again." };
  }
  const src = f.project as Partial<Project>;
  if (!Array.isArray(src.typologies) || !Array.isArray(src.program)) {
    return { ok: false, error: "The project in this file is incomplete." };
  }
  const now = Date.now();
  const base = emptyProject(src.name || "Imported project");
  const project: Project = {
    ...base,
    ...src,
    id: base.id,
    cloudId: undefined,
    classLibrary: undefined,
    createdAt: now,
    updatedAt: now,
  } as Project;
  return {
    ok: true,
    project,
    classLibrary: f.classLibrary && typeof f.classLibrary === "object" ? (f.classLibrary as Record<string, unknown>) : undefined,
  };
}
