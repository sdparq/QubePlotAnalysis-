"use client";
import { useStore, useProject } from "@/lib/store";
import { exportToExcel } from "@/lib/export-xlsx";
import ProjectSwitcher from "./project-switcher";

export default function HeaderBar() {
  const project = useProject();
  const importProject = useStore((s) => s.importProject);

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
        importProject(JSON.parse(reader.result as string));
      } catch {
        alert("Invalid JSON");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  const ghostBtn = "px-3 py-2 text-[11px] font-medium uppercase tracking-[0.10em] border border-bone-100/25 text-bone-100 hover:border-bone-100/60 hover:bg-ink-800 transition-colors";

  return (
    <header className="bg-ink-900 text-bone-100 relative z-30">
      <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-6 flex-wrap min-w-0">
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-qube-400/60 flex items-center justify-center">
              <div className="w-3 h-3 bg-qube-400" />
            </div>
            <div className="leading-tight">
              <div className="wordmark text-bone-100 text-[16px]">QUBE</div>
              <div className="eyebrow text-bone-200/60 text-[9px] mt-0.5">Development</div>
            </div>
          </div>
          <div className="hidden sm:block w-px h-10 bg-bone-100/20" />
          <ProjectSwitcher />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <label className={`${ghostBtn} cursor-pointer`}>
            Import
            <input type="file" accept="application/json" className="hidden" onChange={handleImportJSON} />
          </label>
          <button className={ghostBtn} onClick={handleExportJSON}>Export JSON</button>
          <button
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 transition-colors"
            onClick={() => exportToExcel(project)}
          >Export Excel</button>
        </div>
      </div>
    </header>
  );
}
