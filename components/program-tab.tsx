"use client";
import { useStore } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmt2 } from "@/lib/format";

export default function ProgramTab() {
  const project = useStore((s) => s.project);
  const setCell = useStore((s) => s.setProgramCell);
  const program = computeProgram(project);

  const cellValue = (floor: number, typologyId: string) =>
    project.program.find((c) => c.floor === floor && c.typologyId === typologyId)?.count ?? 0;

  if (project.typologies.length === 0) {
    return (
      <div className="card text-center text-ink-500 italic py-10">
        Add typologies first (tab 02) to start filling the program.
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Program — units per floor</h2>
          <p className="section-sub">Set the count of each typology on each floor. Subtotals update live.</p>
        </div>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="tbl">
            <thead>
              <tr>
                <th className="sticky left-0 bg-bone-50 z-10">Floor</th>
                {project.typologies.map((t) => (
                  <th key={t.id} className="text-right" style={{ minWidth: 96 }}>{t.name}</th>
                ))}
                <th className="text-right">Units</th>
                <th className="text-right">Sellable (m²)</th>
                <th className="text-right">Interior GFA (m²)</th>
              </tr>
            </thead>
            <tbody>
              {program.byFloor.map((f) => (
                <tr key={f.floor}>
                  <td className="sticky left-0 bg-white z-10 font-medium text-ink-900">Floor {f.floor}</td>
                  {project.typologies.map((t) => (
                    <td key={t.id} className="cell-edit">
                      <input
                        type="number"
                        min={0}
                        className="cell-input text-right"
                        value={cellValue(f.floor, t.id)}
                        onChange={(e) => setCell(f.floor, t.id, Math.max(0, Math.round(parseFloat(e.target.value) || 0)))}
                      />
                    </td>
                  ))}
                  <td className="text-right font-medium">{fmt0(f.units)}</td>
                  <td className="text-right">{fmt2(f.totalSellable)}</td>
                  <td className="text-right">{fmt2(f.totalInteriorGFA)}</td>
                </tr>
              ))}
              <tr className="row-total">
                <td className="sticky left-0 bg-bone-200/60 z-10">TOTAL</td>
                {project.typologies.map((t) => {
                  const total = project.program.filter((c) => c.typologyId === t.id).reduce((s, c) => s + c.count, 0);
                  return <td key={t.id} className="text-right">{fmt0(total)}</td>;
                })}
                <td className="text-right">{fmt0(program.totalUnits)}</td>
                <td className="text-right">{fmt2(program.totalSellable)}</td>
                <td className="text-right">{fmt2(program.totalInteriorGFA)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Mix by typology</h2>
        </div>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="tbl">
            <thead>
              <tr>
                <th>Typology</th>
                <th className="text-right">Units</th>
                <th className="text-right">% of total</th>
                <th className="text-right">Total interior (m²)</th>
                <th className="text-right">Total sellable (m²)</th>
              </tr>
            </thead>
            <tbody>
              {program.byTypology.map((ts) => (
                <tr key={ts.typology.id}>
                  <td className="font-medium text-ink-900">{ts.typology.name} <span className="text-ink-400 text-xs ml-1">{ts.typology.category}</span></td>
                  <td className="text-right">{fmt0(ts.totalUnits)}</td>
                  <td className="text-right">{(ts.pctOfTotal * 100).toFixed(1)}%</td>
                  <td className="text-right">{fmt2(ts.totalInteriorGFA)}</td>
                  <td className="text-right">{fmt2(ts.totalSellable)}</td>
                </tr>
              ))}
              <tr className="row-total">
                <td>TOTAL</td>
                <td className="text-right">{fmt0(program.totalUnits)}</td>
                <td className="text-right">100.0%</td>
                <td className="text-right">{fmt2(program.totalInteriorGFA)}</td>
                <td className="text-right">{fmt2(program.totalSellable)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
