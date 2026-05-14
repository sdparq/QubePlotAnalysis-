"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  type CloudProjectSummary,
  type SaveStatus,
  deleteCloudProject,
  listCloudProjects,
  loadCloudProject,
  signInWithPassword,
  signOut,
  upsertCloudProject,
  useAuth,
  useCloudAutoSave,
} from "@/lib/cloud";

function statusLabel(s: SaveStatus, savedAt: number | null): string {
  if (s === "saving") return "Saving…";
  if (s === "error") return "Save failed";
  if (s === "offline") return "Offline";
  if (s === "saved" && savedAt) {
    const d = new Date(savedAt);
    return `Saved ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return "Synced";
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
  const ref = useRef<HTMLDivElement>(null);

  const project = useStore((s) => s.projects[s.activeProjectId]);
  const upsertFromCloud = useStore((s) => s.upsertFromCloud);
  const removeByCloudId = useStore((s) => s.removeByCloudId);
  const linkActiveToCloud = useStore((s) => s.linkActiveToCloud);

  const onStatus = useCallback((s: SaveStatus) => {
    setStatus(s);
    if (s === "saved") setSavedAt(Date.now());
  }, []);
  useCloudAutoSave({ user, onStatus });

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

  // Initial sync once on sign-in: fetch list, pull anything newer in cloud.
  useEffect(() => {
    if (!user) {
      setCloudList(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
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
              useStore.getState().upsertFromCloud(full);
            } catch (e) {
              console.error("pull failed", e);
            }
          }
        }
      } catch (e) {
        console.error("initial cloud sync failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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
      const err = await signInWithPassword(pwd);
      setSigningIn(false);
      if (err) {
        setPwdErr("Wrong password");
      } else {
        setPwd("");
      }
    }
    return (
      <form onSubmit={handleSignIn} className="flex items-center gap-1">
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
        {pwdErr && <span className="text-[10px] text-red-300 ml-1">{pwdErr}</span>}
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
      upsertFromCloud(full, { activate: true });
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 text-[11px] uppercase tracking-[0.10em] text-bone-100 hover:bg-ink-800 transition-colors"
        title="Cloud workspace"
      >
        <span className="w-2 h-2 rounded-full bg-qube-500" />
        <span className="hidden md:inline text-bone-200/80 normal-case tracking-normal">
          {statusLabel(status, savedAt)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[320px] bg-ink-900 border border-bone-100/15 text-bone-100 z-50 shadow-xl">
          <div className="px-4 py-3 border-b border-bone-100/10">
            <div className="text-[11px] uppercase tracking-[0.10em] text-bone-200/60">Cloud workspace</div>
            <div className="text-sm">Connected</div>
            <div className="text-[10px] text-bone-200/50 mt-0.5">{statusLabel(status, savedAt)}</div>
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
