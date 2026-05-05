"use client";
import { useEffect, useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";

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

export default function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const project = useProject();
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeProjectId);
  const switchProject = useStore((s) => s.switchProject);
  const newProject = useStore((s) => s.newProject);
  const loadSample = useStore((s) => s.loadSample);
  const duplicateProject = useStore((s) => s.duplicateProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const sorted = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative leading-tight min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-3 text-left -m-1 p-1 rounded hover:bg-ink-800 transition-colors"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="eyebrow text-bone-200/60">Plot Feasibility</div>
          <div className="text-base font-medium text-bone-100 truncate max-w-[260px] sm:max-w-[360px]">{project.name || "Untitled Project"}</div>
        </div>
        <svg
          className={`w-4 h-4 text-bone-200/70 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        ><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <div className="absolute z-30 top-full left-0 mt-2 w-[420px] max-w-[calc(100vw-2rem)] bg-white text-ink-900 border border-ink-200 shadow-xl">
          <div className="px-4 py-3 border-b border-ink-200 flex items-center justify-between">
            <div>
              <div className="eyebrow text-ink-500">Projects</div>
              <div className="text-xs text-ink-500 mt-0.5">{sorted.length} saved · auto-saved locally</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] border border-ink-300 hover:bg-bone-100 text-ink-800"
                onClick={() => { loadSample(); setOpen(false); }}
              >Sample</button>
              <button
                className="px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] bg-qube-500 hover:bg-qube-600 text-white"
                onClick={() => { newProject(); setOpen(false); }}
              >+ New</button>
            </div>
          </div>

          <ul className="max-h-[60vh] overflow-y-auto">
            {sorted.map((p) => {
              const active = p.id === activeId;
              const units = p.program.reduce((s, c) => s + c.count, 0);
              return (
                <li key={p.id} className={`border-b border-ink-100 last:border-b-0 ${active ? "bg-qube-50" : "hover:bg-bone-50"}`}>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => { switchProject(p.id); setOpen(false); }}
                    >
                      <div className="flex items-center gap-2">
                        {active && <span className="w-1.5 h-1.5 bg-qube-500 rounded-full shrink-0" />}
                        <span className="font-medium text-sm truncate">{p.name || "Untitled Project"}</span>
                      </div>
                      <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-2">
                        <span>{units} units</span>
                        <span>·</span>
                        <span>{p.zone}</span>
                        <span>·</span>
                        <span>updated {relativeTime(p.updatedAt)}</span>
                      </div>
                    </button>
                    <button
                      title="Duplicate"
                      className="p-1.5 text-ink-500 hover:text-ink-900 hover:bg-bone-200 transition-colors"
                      onClick={() => { duplicateProject(p.id); setOpen(false); }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="5" y="5" width="8" height="8" rx="1" />
                        <path d="M3 11V4a1 1 0 011-1h7" />
                      </svg>
                    </button>
                    <button
                      title="Delete"
                      className="p-1.5 text-ink-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                      onClick={() => {
                        if (confirm(`Delete project "${p.name}"? This cannot be undone.`)) deleteProject(p.id);
                      }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4h10M6 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M5 4l.5 9.5a1 1 0 001 1h3a1 1 0 001-1L11 4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-2.5 bg-bone-50 border-t border-ink-200 text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
            Tip: rename in Setup → Project name
          </div>
        </div>
      )}
    </div>
  );
}
