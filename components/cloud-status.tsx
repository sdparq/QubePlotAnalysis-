"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  type CloudProjectSummary,
  type SaveStatus,
  acquireLock,
  applyingCloudChange,
  deleteCloudProject,
  getDeviceLabel,
  listCloudProjects,
  loadCloudProject,
  releaseLock,
  setDeviceLabel,
  signInWithPassword,
  signOut,
  upsertCloudProject,
  useAuth,
  useCloudAutoSave,
} from "@/lib/cloud";

function statusLabel(s: SaveStatus, savedAt: number | null, linked: boolean): string {
  if (s === "saving") return "Saving…";
  if (s === "error") return "Save failed";
  if (s === "offline") return "Offline";
  if (s === "locked") return "Read-only · locked";
  if (s === "saved" && savedAt) {
    const d = new Date(savedAt);
    return `Saved ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  // Never claim "Synced" for a project that has no cloud row yet — that
  // exact lie sent people to a second computer expecting to find their work.
  return linked ? "Synced" : "Not in cloud yet";
}

function relativeTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function CloudStatus() {
  const { user, loading, enabled } = useAuth();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [cloudList, setCloudList] = useState<CloudProjectSummary[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pwd, setPwd] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const lockedByRef = useRef<{ projectId: string; heldBy: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const project = useStore((s) => s.projects[s.activeProjectId]);
  const upsertFromCloud = useStore((s) => s.upsertFromCloud);
  const removeByCloudId = useStore((s) => s.removeByCloudId);
  const linkActiveToCloud = useStore((s) => s.linkActiveToCloud);

  useEffect(() => setDeviceName(getDeviceLabel()), []);

  const onStatus = useCallback((s: SaveStatus) => {
    setStatus(s);
    if (s === "saved") setSavedAt(Date.now());
  }, []);
  const isBlocked = useCallback(
    (p: { cloudId?: string }) =>
      !!p.cloudId && lockedByRef.current?.projectId === p.cloudId,
    [],
  );
  useCloudAutoSave({ user, onStatus, isBlocked });

  // ── Edit lock on the ACTIVE project ──────────────────────────────────────
  // Claim it when the project becomes active, heartbeat it while we hold it,
  // release on switch/sign-out. If a teammate holds it, this device becomes
  // read-only for that project (auto-save blocked + banner).
  useEffect(() => {
    if (!user || !project?.cloudId) {
      lockedByRef.current = null;
      setLockedBy(null);
      return;
    }
    const projectId = project.cloudId;
    let stopped = false;
    const tick = async () => {
      const r = await acquireLock(projectId);
      if (stopped) return;
      if (r.state === "other") {
        lockedByRef.current = { projectId, heldBy: r.heldBy };
        setLockedBy(r.heldBy);
      } else {
        lockedByRef.current = null;
        setLockedBy(null);
      }
    };
    void tick();
    const iv = setInterval(tick, 30_000);
    return () => {
      stopped = true;
      clearInterval(iv);
      lockedByRef.current = null;
      setLockedBy(null);
      void releaseLock(projectId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, project?.cloudId]);

  // ── Continuous pull ──────────────────────────────────────────────────────
  // The initial sync below runs once per sign-in; teammates' edits made while
  // this tab stays open would otherwise never arrive. Poll every 30 s and on
  // tab focus, pulling any cloud row newer than its local copy.
  useEffect(() => {
    if (!user) return;
    let running = false;
    const pull = async () => {
      if (running) return;
      running = true;
      try {
        const list = await listCloudProjects();
        setCloudList(list);
        const state = useStore.getState();
        for (const row of list) {
          const local = state.projects[row.id];
          if (!local || row.updatedAt > local.updatedAt) {
            const full = await loadCloudProject(row.id);
            applyingCloudChange(() => useStore.getState().upsertFromCloud(full));
          }
        }
      } catch (e) {
        console.error("cloud poll failed", e);
      } finally {
        running = false;
      }
    };
    const iv = setInterval(pull, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Close dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Pull project list whenever dropdown opens (and on first sign-in).
  const refresh = useCallback(async () => {
    if (!user) return;
    setListLoading(true);
    setErr(null);
    try {
      const list = await listCloudProjects();
      setCloudList(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setListLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && open && cloudList === null) {
      refresh();
    }
  }, [user, open, cloudList, refresh]);

  // Initial sync once on sign-in: fetch list, pull anything newer in cloud,
  // then PUSH UP any local project the user has actually worked on that never
  // reached the cloud (created before unlocking, offline edits...). Without
  // the push leg, work done before signing in silently stays on one machine.
  // Keyed on user.id so Supabase token refreshes (new user object, same id)
  // don't re-trigger a full sync.
  useEffect(() => {
    if (!user) {
      setCloudList(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Heal duplicates that inherited another project's cloud row (created
        // before duplicateProject stripped cloudId). A properly linked project
        // always has id === cloudId; anything else shares a row with the
        // original and their contents ping-pong. Detach it — the push leg
        // below then inserts it as its own row.
        const healed = new Set<string>();
        for (const p of Object.values(useStore.getState().projects)) {
          if (p.cloudId && p.id !== p.cloudId) {
            console.warn(`qube: detaching "${p.name}" from a shared cloud row (duplicate heal)`);
            useStore.getState().unlinkProject(p.id);
            healed.add(p.id);
          }
        }
        const list = await listCloudProjects();
        if (cancelled) return;
        setCloudList(list);
        const state = useStore.getState();
        for (const row of list) {
          const local = state.projects[row.id];
          if (!local || row.updatedAt > local.updatedAt) {
            try {
              const full = await loadCloudProject(row.id);
              if (cancelled) return;
              // Mark as a cloud-sourced change so the auto-saver adopts it as
              // its baseline instead of echoing it straight back up.
              applyingCloudChange(() => useStore.getState().upsertFromCloud(full));
            } catch (e) {
              console.error("pull failed", e);
            }
          }
        }
        // Push leg. Skip untouched projects (updatedAt ≈ createdAt): every
        // fresh browser seeds a pristine sample project, and auto-uploading
        // those would litter the team workspace with duplicates.
        let pushed = false;
        for (const p of Object.values(useStore.getState().projects)) {
          if (cancelled) return;
          if (p.cloudId) continue;
          // Healed duplicates go up regardless of the untouched-sample guard —
          // they carry real content that must land in its own row.
          if (!healed.has(p.id) && p.updatedAt - p.createdAt < 2000) continue;
          try {
            const id = await upsertCloudProject(p);
            applyingCloudChange(() => useStore.getState().linkProjectToCloud(p.id, id));
            pushed = true;
          } catch (e) {
            console.error("push failed", e);
          }
        }
        if (pushed && !cancelled) {
          try {
            setCloudList(await listCloudProjects());
          } catch { /* list refresh is cosmetic */ }
        }
      } catch (e) {
        console.error("initial cloud sync failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!enabled) return null;

  const ghostBtn =
    "px-3 py-2 text-[11px] font-medium uppercase tracking-[0.10em] border border-bone-100/25 text-bone-100 hover:border-bone-100/60 hover:bg-ink-800 transition-colors";

  if (loading) {
    return <div className="text-[11px] uppercase tracking-[0.10em] text-bone-200/60">Cloud…</div>;
  }

  if (!user) {
    async function handleSignIn(e: React.FormEvent) {
      e.preventDefault();
      if (!pwd) return;
      setSigningIn(true);
      setPwdErr(null);
      try {
        const err = await signInWithPassword(pwd);
        if (err) {
          // "Invalid login credentials" is Supabase's generic wrong-email-or-
          // password response — translate that one. Anything else (network
          // failure, paused/deleted project, misconfigured URL/key) is shown
          // as-is: it's not a password problem and saying "Wrong password"
          // would send whoever's debugging this straight down the wrong path.
          setPwdErr(/invalid login credentials/i.test(err) ? "Wrong password" : err);
        } else {
          setPwd("");
        }
      } finally {
        // Always runs, even if signInWithPassword itself threw — otherwise the
        // button stays stuck on "…" forever with no visible error.
        setSigningIn(false);
      }
    }
    return (
      <form onSubmit={handleSignIn} className="flex items-center gap-1 flex-wrap justify-end max-w-[320px]">
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="Team password"
          autoComplete="current-password"
          className="px-2 py-1.5 text-[12px] bg-ink-800 border border-bone-100/25 text-bone-100 placeholder-bone-200/40 focus:border-bone-100/60 focus:outline-none w-[140px]"
        />
        <button type="submit" className={ghostBtn} disabled={signingIn || !pwd}>
          {signingIn ? "…" : "Unlock"}
        </button>
        {pwdErr && (
          <span className="basis-full text-[10px] text-red-300 text-right leading-snug">{pwdErr}</span>
        )}
      </form>
    );
  }

  async function handleSaveToCloud() {
    if (!project) return;
    setStatus("saving");
    try {
      const id = await upsertCloudProject(project);
      if (!project.cloudId) linkActiveToCloud(id);
      setStatus("saved");
      setSavedAt(Date.now());
      refresh();
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  async function handleOpenCloud(id: string) {
    try {
      const full = await loadCloudProject(id);
      applyingCloudChange(() => upsertFromCloud(full, { activate: true }));
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to open");
    }
  }

  async function handleDeleteCloud(id: string) {
    if (!confirm("Delete this project from the cloud? This affects every signed-in user.")) return;
    try {
      await deleteCloudProject(id);
      removeByCloudId(id);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="relative" ref={ref}>
      {lockedBy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-amber-500 text-ink-900 text-[12.5px] font-medium shadow-lg rounded-sm flex items-center gap-2 max-w-[92vw]">
          <span>🔒</span>
          <span>
            <strong>{lockedBy}</strong> is editing this project — you are in read-only mode.
            Changes you make here stay on this computer and won&apos;t sync.
          </span>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 text-[11px] uppercase tracking-[0.10em] text-bone-100 hover:bg-ink-800 transition-colors"
        title="Cloud workspace"
      >
        <span className={`w-2 h-2 rounded-full ${lockedBy ? "bg-amber-400" : "bg-qube-500"}`} />
        <span className="hidden md:inline text-bone-200/80 normal-case tracking-normal">
          {lockedBy ? "Read-only · locked" : statusLabel(status, savedAt, !!project?.cloudId)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[320px] bg-ink-900 border border-bone-100/15 text-bone-100 z-50 shadow-xl">
          <div className="px-4 py-3 border-b border-bone-100/10">
            <div className="text-[11px] uppercase tracking-[0.10em] text-bone-200/60">Cloud workspace</div>
            <div className="text-sm">Connected</div>
            <div className="text-[10px] text-bone-200/50 mt-0.5">{statusLabel(status, savedAt, !!project?.cloudId)}</div>
            <label className="block mt-2 text-[10px] uppercase tracking-[0.10em] text-bone-200/60">
              Your name <span className="normal-case tracking-normal">(shown to teammates when you hold a project)</span>
              <input
                type="text"
                value={deviceName}
                placeholder="e.g. Santiago"
                onChange={(e) => {
                  setDeviceName(e.target.value);
                  setDeviceLabel(e.target.value);
                }}
                className="mt-1 w-full px-2 py-1.5 text-[12px] normal-case tracking-normal bg-ink-800 border border-bone-100/25 text-bone-100 placeholder-bone-200/40 focus:border-bone-100/60 focus:outline-none"
              />
            </label>
          </div>

          <div className="px-4 py-3 border-b border-bone-100/10 flex items-center gap-2">
            {!project?.cloudId ? (
              <button onClick={handleSaveToCloud} className={ghostBtn}>
                Save current to cloud
              </button>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.10em] text-bone-200/50">
                Auto-saving
              </span>
            )}
            <button onClick={refresh} className={`${ghostBtn} ml-auto`} disabled={listLoading}>
              {listLoading ? "…" : "Refresh"}
            </button>
          </div>

          <div className="max-h-[280px] overflow-y-auto">
            {err && <div className="px-4 py-2 text-[11px] text-red-300">{err}</div>}
            {cloudList === null ? (
              <div className="px-4 py-3 text-[11px] text-bone-200/50">Loading…</div>
            ) : cloudList.length === 0 ? (
              <div className="px-4 py-3 text-[11px] text-bone-200/50">No cloud projects yet.</div>
            ) : (
              cloudList.map((row) => {
                const isActive = project?.cloudId === row.id;
                return (
                  <div
                    key={row.id}
                    className={`px-4 py-2 flex items-center gap-2 border-b border-bone-100/5 hover:bg-ink-800 ${
                      isActive ? "bg-ink-800" : ""
                    }`}
                  >
                    <button
                      onClick={() => handleOpenCloud(row.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm truncate">{row.name}</div>
                      <div className="text-[10px] text-bone-200/50">
                        updated {relativeTime(row.updatedAt)}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteCloud(row.id)}
                      className="text-[10px] uppercase tracking-[0.10em] text-bone-200/40 hover:text-red-300"
                      title="Delete from cloud"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="px-4 py-3 border-t border-bone-100/10 flex justify-end">
            <button onClick={() => signOut()} className={ghostBtn}>
              Lock
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
