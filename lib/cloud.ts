"use client";
import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, isCloudEnabled, sharedEmail } from "./supabase";
import type { Project } from "./types";
import { useStore } from "./store";

export type CloudProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  updatedBy: string | null;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

/* --------------------------------- Auth ---------------------------------- */

export function useAuth(): {
  user: User | null;
  session: Session | null;
  loading: boolean;
  enabled: boolean;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    let mounted = true;
    sb.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user: session?.user ?? null, session, loading, enabled: isCloudEnabled };
}

/** Sign in to the shared team account. Returns an error message or null on success. */
export async function signInWithPassword(password: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Cloud not configured";
  const { error } = await sb.auth.signInWithPassword({
    email: sharedEmail,
    password,
  });
  if (error) return error.message;
  return null;
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/* ------------------------------ CRUD helpers ----------------------------- */

type Row = {
  id: string;
  name: string;
  data: Project;
  updated_at: string;
  updated_by: string | null;
};

export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("projects")
    .select("id, name, updated_at, updated_by")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: new Date(r.updated_at as string).getTime(),
    updatedBy: (r.updated_by as string) ?? null,
  }));
}

export async function loadCloudProject(cloudId: string): Promise<Project> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud not configured");
  const { data, error } = await sb
    .from("projects")
    .select("id, name, data, updated_at")
    .eq("id", cloudId)
    .single();
  if (error) throw error;
  const row = data as unknown as Row;
  const base = row.data ?? ({} as Project);
  return {
    ...base,
    id: row.id,
    cloudId: row.id,
    name: row.name,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/** Insert or update. Returns the cloud uuid of the row. */
export async function upsertCloudProject(project: Project): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud not configured");

  const payload = {
    name: project.name || "Untitled project",
    data: project,
    updated_at: new Date().toISOString(),
  };

  if (project.cloudId) {
    const { error } = await sb.from("projects").update(payload).eq("id", project.cloudId);
    if (error) throw error;
    return project.cloudId;
  }

  const { data: userData } = await sb.auth.getUser();
  const insertPayload = {
    ...payload,
    created_by: userData.user?.id ?? null,
    updated_by: userData.user?.id ?? null,
  };
  const { data, error } = await sb
    .from("projects")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteCloudProject(cloudId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("projects").delete().eq("id", cloudId);
  if (error) throw error;
}

/* --------------------------- Auto-save hook ------------------------------ */

/** Depth counter for changes that COME FROM the cloud (initial sync, opening a
 *  cloud project). While > 0, the auto-saver treats store updates as already
 *  persisted — it refreshes its baseline instead of scheduling an echo upload
 *  that would pointlessly bump `updated_at` and could clobber concurrent
 *  edits from another device. */
let cloudApplyDepth = 0;
export function applyingCloudChange<T>(fn: () => T): T {
  cloudApplyDepth++;
  try {
    return fn();
  } finally {
    cloudApplyDepth--;
  }
}

/** Debounced auto-saver for the active project. Only saves projects that
 *  already have a cloudId (i.e. were created or pulled from the cloud). */
export function useCloudAutoSave(opts: {
  user: User | null;
  onStatus: (s: SaveStatus) => void;
}) {
  const { user, onStatus } = opts;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of the project waiting to be uploaded. Captured at schedule time
  // so a project switch can't redirect the pending save to the wrong project.
  const pendingRef = useRef<Project | null>(null);
  // Serialisation of the last successfully uploaded state, keyed by cloudId so
  // baselines from different projects can't collide.
  const lastSentRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!user || !isCloudEnabled) return;

    const flush = async () => {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!p || !p.cloudId) return;
      const serialised = JSON.stringify(p);
      if (serialised === lastSentRef.current.get(p.cloudId)) return;
      onStatus("saving");
      try {
        await upsertCloudProject(p);
        // Only mark as sent AFTER success — a failed upload must retry on the
        // next change (or next flush) instead of being silently swallowed.
        lastSentRef.current.set(p.cloudId, serialised);
        onStatus("saved");
      } catch (err) {
        console.error("cloud save failed", err);
        onStatus("error");
      }
    };

    const schedule = (p: Project) => {
      pendingRef.current = p;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 1500);
    };

    const unsub = useStore.subscribe((state, prev) => {
      const cur = state.projects[state.activeProjectId];
      if (!cur) return;
      // Changes applied FROM the cloud are already persisted — adopt them as
      // the baseline rather than echoing them back up.
      if (cloudApplyDepth > 0) {
        if (cur.cloudId) lastSentRef.current.set(cur.cloudId, JSON.stringify(cur));
        return;
      }
      if (state.activeProjectId !== prev.activeProjectId) {
        // Project switch: if an edit to the previous project is still waiting
        // on the debounce, upload it now instead of dropping it.
        if (pendingRef.current) void flush();
        return;
      }
      if (cur === prev.projects[prev.activeProjectId]) return;
      schedule(cur);
    });

    return () => {
      // Last-gasp flush on unmount / sign-out so a just-made edit isn't lost.
      if (pendingRef.current) void flush();
      if (timerRef.current) clearTimeout(timerRef.current);
      unsub();
    };
    // Keyed on user.id (not the object): Supabase token refreshes mint a new
    // user object and would otherwise tear down + re-prime this effect,
    // discarding a pending debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, onStatus]);
}
