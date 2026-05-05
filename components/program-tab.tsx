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
      <div className="card text-center text-slate-500 italic py-8">
        Add typologies first (tab 2) to start filling the program.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="card">
        <h2 className="section-title">Program — units per floor</h2>
        <p className="section-sub mb-4">Set the count of each typology on each floor. Subtotals update live.</p>
        <div className="overflow-x-auto">
          <table className="tbl min-w-max">
            <thead>
              <tr>
                <th className="sticky left-0 bg-slate-50 z-10">Floor</th>
                {project.typologies.map((t) => (
                  <th key={t.id} className="text-right whitespace-nowrap">{t.name}</th>
                ))}
                <th className="text-right">Units</th>
                <th className="text-right">Sellable (m²)</th>
                <th className="text-right">Interior GFA (m²)</th>
              </tr>
            </thead>
            <tbody>
              {program.byFloor.map((f) => (
                <tr key={f.floor}>
                  <td className="sticky left-0 bg-white font-medium z-10">Floor {f.floor}</td>
                  {project.typologies.map((t) => (
                    <td key={t.id} className="p-1">
                      <input
                        type="number"
                        min={0}
                        className="cell-input text-right w-20"
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
              <tr className="font-semibold bg-slate-50">
                <td className="sticky left-0 bg-slate-50 z-10">TOTAL</td>
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
        <h2 className="section-title">Mix by category</h2>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Typology</th><th className="text-right">Units</th><th className="text-right">% of total</th><th className="text-right">Total interior (m²)</th><th className="text-right">Total sellable (m²)</th></tr>
            </thead>
            <tbody>
              {program.byTypology.map((ts) => (
                <tr key={ts.typology.id}>
                  <td>{ts.typology.name} <span className="text-slate-400 text-xs ml-1">({ts.typology.category})</span></td>
                  <td className="text-right">{fmt0(ts.totalUnits)}</td>
                  <td className="text-right">{(ts.pctOfTotal * 100).toFixed(1)}%</td>
                  <td className="text-right">{fmt2(ts.totalInteriorGFA)}</td>
                  <td className="text-right">{fmt2(ts.totalSellable)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-slate-50">
                <td>TOTAL</td>
                <td className="text-right">{fmt0(program.totalUnits)}</td>
                <td className="text-right">100%</td>
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
