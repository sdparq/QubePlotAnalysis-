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

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline" | "locked";

/* --------------------------- Device identity ------------------------------ */
/* The whole team signs in with ONE shared Supabase user, so auth identity
 * cannot tell teammates apart. Each browser gets a stable random device id,
 * plus a human label ("Santiago") used for the edit-lock presence. */

const DEVICE_ID_KEY = "qube.device.id";
const DEVICE_NAME_KEY = "qube.device.name";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceLabel(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(DEVICE_NAME_KEY) ?? "";
}

export function setDeviceLabel(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEVICE_NAME_KEY, name.trim());
}

/* ------------------------------ Edit locks -------------------------------- */
/* Soft per-project edit locks in a `project_locks` table (see README §Supabase
 * for the SQL). A lock is honoured while its heartbeat is fresh; stale locks
 * (browser crashed, laptop closed) expire after LOCK_STALE_MS and can be
 * taken over. If the table doesn't exist yet the app degrades gracefully:
 * locking is simply inactive. */

export const LOCK_STALE_MS = 90_000;

export type LockResult =
  | { state: "mine" }
  | { state: "other"; heldBy: string }
  | { state: "unavailable" };

let warnedNoLockTable = false;

/** Try to take (or refresh) the edit lock on a project. Doubles as the
 *  heartbeat: call it periodically while the project is active. */
export async function acquireLock(projectId: string): Promise<LockResult> {
  const sb = getSupabase();
  if (!sb) return { state: "unavailable" };
  const deviceId = getDeviceId();
  const label = getDeviceLabel() || "a teammate";
  try {
    const { data, error: selErr } = await sb
      .from("project_locks")
      .select("device_id, label, locked_at")
      .eq("project_id", projectId)
      .maybeSingle();
    if (selErr) throw selErr;
    if (
      data &&
      data.device_id !== deviceId &&
      Date.now() - new Date(data.locked_at as string).getTime() < LOCK_STALE_MS
    ) {
      return { state: "other", heldBy: (data.label as string) || "a teammate" };
    }
    const { error: upErr } = await sb.from("project_locks").upsert({
      project_id: projectId,
      device_id: deviceId,
      label,
      locked_at: new Date().toISOString(),
    });
    if (upErr) throw upErr;
    // Confirm we won any write race.
    const { data: after } = await sb
      .from("project_locks")
      .select("device_id, label")
      .eq("project_id", projectId)
      .maybeSingle();
    if (after && after.device_id !== deviceId) {
      return { state: "other", heldBy: (after.label as string) || "a teammate" };
    }
    return { state: "mine" };
  } catch (e) {
    if (!warnedNoLockTable) {
      warnedNoLockTable = true;
      console.warn(
        "qube: project_locks unavailable — edit locking disabled. Run the project_locks SQL from the README in Supabase to enable it.",
        e,
      );
    }
    return { state: "unavailable" };
  }
}

/** Release the lock if THIS device holds it. Best effort. */
export async function releaseLock(projectId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb
      .from("project_locks")
      .delete()
      .eq("project_id", projectId)
      .eq("device_id", getDeviceId());
  } catch {
    /* stale-lock expiry covers us */
  }
}

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
    // A rejected promise here (dead network, corrupted persisted session token,
    // Supabase project paused/unreachable) must not leave `loading` stuck at
    // `true` forever — that reads as "the cloud widget silently disappeared"
    // since CloudStatus renders nothing but "Cloud…" while loading is true.
    sb.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
      })
      .catch((e) => {
        console.error("getSession failed", e);
      })
      .finally(() => {
        if (mounted) setLoading(false);
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
  try {
    const { error } = await sb.auth.signInWithPassword({
      email: sharedEmail,
      password,
    });
    if (error) return error.message;
    return null;
  } catch (e) {
    // A network/CORS/DNS failure (wrong URL, paused or deleted Supabase
    // project, offline) throws here instead of resolving with `{ error }` —
    // without this catch the caller's "signing in…" state never clears.
    return e instanceof Error ? e.message : "Could not reach Supabase";
  }
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

/** Debounced auto-saver for the active project. Projects already linked to a
 *  cloud row are updated in place; a project WITHOUT a cloudId (created
 *  locally) is inserted on its first edit and linked automatically — nobody
 *  should have to find a "save to cloud" button for their work to reach the
 *  team workspace. */
export function useCloudAutoSave(opts: {
  user: User | null;
  onStatus: (s: SaveStatus) => void;
  /** When it returns true for a project, its edits are NOT uploaded (another
   *  device holds the edit lock) — they stay local to this browser. */
  isBlocked?: (p: Project) => boolean;
}) {
  const { user, onStatus, isBlocked } = opts;
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of the project waiting to be uploaded. Captured at schedule time
  // so a project switch can't redirect the pending save to the wrong project.
  const pendingRef = useRef<Project | null>(null);
  // Serialisation of the last successfully uploaded state, keyed by cloudId so
  // baselines from different projects can't collide.
  const lastSentRef = useRef<Map<string, string>>(new Map());
  // Local ids with an INSERT currently on the wire (see flush).
  const insertingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !isCloudEnabled) return;

    const flush = async () => {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!p) return;
      if (isBlockedRef.current?.(p)) {
        onStatus("locked");
        return;
      }
      const serialised = JSON.stringify(p);
      if (p.cloudId && serialised === lastSentRef.current.get(p.cloudId)) return;
      onStatus("saving");
      try {
        if (p.cloudId) {
          await upsertCloudProject(p);
          // Only mark as sent AFTER success — a failed upload must retry on
          // the next change (or next flush) instead of being silently
          // swallowed.
          lastSentRef.current.set(p.cloudId, serialised);
        } else if (!insertingRef.current.has(p.id)) {
          // First edit of a local-only project: insert it and adopt the cloud
          // id. The re-keying is a cloud-sourced change — don't echo it up.
          // The in-flight set stops a concurrent flush from inserting the same
          // project twice while the first insert is still on the wire.
          insertingRef.current.add(p.id);
          try {
            const id = await upsertCloudProject(p);
            applyingCloudChange(() => useStore.getState().linkProjectToCloud(p.id, id));
            const linked = useStore.getState().projects[id];
            if (linked) lastSentRef.current.set(id, JSON.stringify(linked));
          } finally {
            insertingRef.current.delete(p.id);
          }
        }
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
