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
        const obj = JSON.parse(reader.result as string);
        useStore.getState().setProject(obj);
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  async function handleExportXLSX() {
    await exportToExcel(project);
  }

  return (
    <header className="bg-brand-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-brand-100/70">Qube · Plot Feasibility</div>
          <h1 className="text-xl font-semibold">{project.name || "Untitled Project"}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-secondary" onClick={loadSample}>Load Production City sample</button>
          <button className="btn btn-secondary" onClick={() => { if (confirm("Discard current analysis and start blank?")) reset(); }}>New blank</button>
          <label className="btn btn-secondary cursor-pointer">
            Import JSON
            <input type="file" accept="application/json" className="hidden" onChange={handleImportJSON} />
          </label>
          <button className="btn btn-secondary" onClick={handleExportJSON}>Export JSON</button>
          <button className="btn btn-primary" onClick={handleExportXLSX}>Export Excel</button>
        </div>
      </div>
    </header>
  );
}
