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

/** Debounced auto-saver for the active project. Only saves projects that
 *  already have a cloudId (i.e. were created or pulled from the cloud). */
export function useCloudAutoSave(opts: {
  user: User | null;
  onStatus: (s: SaveStatus) => void;
}) {
  const { user, onStatus } = opts;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    if (!user || !isCloudEnabled) return;

    const flush = async () => {
      const st = useStore.getState();
      const p = st.projects[st.activeProjectId];
      if (!p || !p.cloudId) return;
      const serialised = JSON.stringify(p);
      if (serialised === lastSentRef.current) return;
      lastSentRef.current = serialised;
      onStatus("saving");
      try {
        await upsertCloudProject(p);
        onStatus("saved");
      } catch (err) {
        console.error("cloud save failed", err);
        onStatus("error");
      }
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 1500);
    };

    // Prime the baseline so the initial pull doesn't immediately bounce back.
    const initial = useStore.getState();
    const initialActive = initial.projects[initial.activeProjectId];
    lastSentRef.current = initialActive ? JSON.stringify(initialActive) : "";

    const unsub = useStore.subscribe((state, prev) => {
      const cur = state.projects[state.activeProjectId];
      if (!cur) return;
      if (state.activeProjectId !== prev.activeProjectId) {
        lastSentRef.current = JSON.stringify(cur);
        return;
      }
      if (cur === prev.projects[prev.activeProjectId]) return;
      schedule();
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsub();
    };
  }, [user, onStatus]);
}
