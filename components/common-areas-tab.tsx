"use client";
import { useStore, useProject } from "@/lib/store";
import { fmt2 } from "@/lib/format";
import type { CommonArea } from "@/lib/types";

export default function CommonAreasTab() {
  const project = useProject();
  const upsert = useStore((s) => s.upsertCommonArea);
  const remove = useStore((s) => s.removeCommonArea);

  function addNew() {
    upsert({
      id: `ca-${Date.now()}`,
      name: "New element",
      area: 0,
      floors: 1,
      countAsGFA: true,
    });
  }
  function update(c: CommonArea, patch: Partial<CommonArea>) {
    upsert({ ...c, ...patch });
  }

  const totalGFA = project.commonAreas.filter((c) => c.countAsGFA).reduce((s, c) => s + c.area * c.floors, 0);
  const totalNonGFA = project.commonAreas.filter((c) => !c.countAsGFA).reduce((s, c) => s + c.area * c.floors, 0);

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Common Areas & Services</h2>
            <p className="section-sub">Lobbies, corridors, lifts, MEP, amenities. Mark "GFA" if it counts towards built area; uncheck for open-air or rooftop amenities.</p>
          </div>
          <button className="btn btn-primary" onClick={addNew}>+ Add element</button>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 60 }} />
              <col />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Element</th>
                <th className="text-right">Area (m²)</th>
                <th className="text-right">Floors</th>
                <th className="text-right">Total (m²)</th>
                <th className="text-center">GFA</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.commonAreas.map((c) => (
                <tr key={c.id}>
                  <td className="cell-edit">
                    <input className="cell-input" value={c.name} onChange={(e) => update(c, { name: e.target.value })} />
                  </td>
                  <td className="cell-edit">
                    <input type="number" step={0.01} className="cell-input text-right" value={c.area} onChange={(e) => update(c, { area: parseFloat(e.target.value) || 0 })} />
                  </td>
                  <td className="cell-edit">
                    <input type="number" min={1} step={1} className="cell-input text-right" value={c.floors} onChange={(e) => update(c, { floors: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })} />
                  </td>
                  <td className="text-right">{fmt2(c.area * c.floors)}</td>
                  <td className="text-center">
                    <input type="checkbox" className="accent-qube-500 w-4 h-4" checked={c.countAsGFA} onChange={(e) => update(c, { countAsGFA: e.target.checked })} />
                  </td>
                  <td className="cell-edit">
                    <input className="cell-input" value={c.notes ?? ""} onChange={(e) => update(c, { notes: e.target.value })} />
                  </td>
                  <td className="text-right">
                    <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove(c.id); }}>Delete</button>
                  </td>
                </tr>
              ))}
              <tr className="row-subtotal">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal — counts as GFA</td>
                <td className="text-right">{fmt2(totalGFA)}</td>
                <td colSpan={3}></td>
              </tr>
              <tr className="row-subtotal">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal — non-GFA (open air)</td>
                <td className="text-right">{fmt2(totalNonGFA)}</td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
