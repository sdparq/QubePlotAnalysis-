"use client";
import { useStore, useProject } from "@/lib/store";
import { fmt2, fmtPct } from "@/lib/format";
import { computeProgram } from "@/lib/calc/program";
import { commonAreaCategory, type CommonArea, type CommonAreaCategory } from "@/lib/types";

export default function CommonAreasTab() {
  const project = useProject();
  const upsert = useStore((s) => s.upsertCommonArea);
  const remove = useStore((s) => s.removeCommonArea);
  const program = computeProgram(project);

  function addNew() {
    upsert({
      id: `ca-${Date.now()}`,
      name: "New element",
      area: 0,
      floors: 1,
      category: "GFA",
    });
  }
  function update(c: CommonArea, patch: Partial<CommonArea>) {
    upsert({ ...c, ...patch });
  }

  const totalGFA = program.commonAreasGFA;
  const totalBUAonly = program.commonAreasBUAonly;
  const totalOpen = program.commonAreasOpen;
  const buaTotal = program.totalBUABuilding;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Common Areas & Services</h2>
            <p className="section-sub">
              Lobbies, corridors, lifts, MEP, amenities. <strong>GFA</strong> counts towards FAR; <strong>BUA</strong>-only is built area
              that does not count for FAR (shafts, lift cores, stair cores, MEP, basement parking); <strong>Open</strong> for
              rooftop / open-air amenities.
            </p>
          </div>
          <button className="btn btn-primary" onClick={addNew}>+ Add element</button>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
              <col />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Element</th>
                <th className="text-right">Area (m²)</th>
                <th className="text-right">Floors</th>
                <th className="text-right">Total (m²)</th>
                <th>Category</th>
                <th className="text-right">% BUA</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.commonAreas.map((c) => {
                const total = c.area * c.floors;
                const cat = commonAreaCategory(c);
                const pctOfBUA = cat === "OPEN" || buaTotal === 0 ? 0 : total / buaTotal;
                return (
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
                    <td className="text-right">{fmt2(total)}</td>
                    <td className="cell-edit">
                      <select
                        className="cell-input"
                        value={cat}
                        onChange={(e) => update(c, { category: e.target.value as CommonAreaCategory, countAsGFA: undefined })}
                      >
                        <option value="GFA">GFA</option>
                        <option value="BUA">BUA</option>
                        <option value="OPEN">Open</option>
                      </select>
                    </td>
                    <td className="text-right text-ink-700 tabular-nums">
                      {cat === "OPEN" ? "—" : fmtPct(pctOfBUA, 2)}
                    </td>
                    <td className="cell-edit">
                      <input className="cell-input" value={c.notes ?? ""} onChange={(e) => update(c, { notes: e.target.value })} />
                    </td>
                    <td className="text-right">
                      <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Delete ${c.name}?`)) remove(c.id); }}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="row-subtotal">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal · GFA</td>
                <td className="text-right">{fmt2(totalGFA)}</td>
                <td colSpan={4}></td>
              </tr>
              <tr className="row-subtotal">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal · BUA only</td>
                <td className="text-right">{fmt2(totalBUAonly)}</td>
                <td colSpan={4}></td>
              </tr>
              <tr className="row-subtotal">
                <td colSpan={3} className="text-right uppercase tracking-[0.10em] text-[11px]">Subtotal · Open air</td>
                <td className="text-right">{fmt2(totalOpen)}</td>
                <td colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Total GFA" value={`${fmt2(program.totalGFABuilding)} m²`} sub={`FAR ${program.far.toFixed(2)}`} />
          <Kpi label="Total BUA" value={`${fmt2(program.totalBUABuilding)} m²`} sub="GFA + balconies + BUA-only commons" />
          <Kpi label="GFA / BUA" value={fmtPct(program.totalGFABuilding / (program.totalBUABuilding || 1), 1)} sub="Net efficiency" />
          <Kpi label="Open-air (non-built)" value={`${fmt2(totalOpen)} m²`} sub="Excluded from BUA" />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}
