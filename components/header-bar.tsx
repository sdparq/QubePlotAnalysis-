"use client";
import { useStore } from "@/lib/store";
import { exportToExcel } from "@/lib/export-xlsx";

export default function HeaderBar() {
  const project = useStore((s) => s.project);
  const loadSample = useStore((s) => s.loadSample);
  const reset = useStore((s) => s.reset);

  function handleExportJSON() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project.name || "project").replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        useStore.getState().setProject(JSON.parse(reader.result as string));
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  return (
    <header className="bg-ink-900 text-bone-100">
      <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-bone-100/40 flex items-center justify-center">
              <div className="w-3 h-3 bg-qube-400" />
            </div>
            <div className="leading-tight">
              <div className="wordmark text-bone-100 text-[15px]">QUBE</div>
              <div className="eyebrow text-bone-200/60 text-[9px]">Development</div>
            </div>
          </div>
          <div className="hidden sm:block w-px h-9 bg-bone-100/15" />
          <div className="leading-tight">
            <div className="eyebrow text-bone-200/60">Plot Feasibility</div>
            <div className="text-base font-medium text-bone-100">{project.name || "Untitled Project"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-ghost text-bone-100 hover:text-qube-300" onClick={loadSample}>Load sample</button>
          <button className="btn btn-ghost text-bone-100 hover:text-qube-300" onClick={() => { if (confirm("Discard current analysis and start blank?")) reset(); }}>New blank</button>
          <label className="btn btn-secondary border-bone-100/30 text-bone-100 hover:border-bone-100 hover:bg-ink-800 cursor-pointer">
            Import
            <input type="file" accept="application/json" className="hidden" onChange={handleImportJSON} />
          </label>
          <button className="btn btn-secondary border-bone-100/30 text-bone-100 hover:border-bone-100 hover:bg-ink-800" onClick={handleExportJSON}>Export JSON</button>
          <button className="btn bg-qube-500 text-ink-900 hover:bg-qube-400" onClick={() => exportToExcel(project)}>Export Excel</button>
        </div>
      </div>
    </header>
  );
}
