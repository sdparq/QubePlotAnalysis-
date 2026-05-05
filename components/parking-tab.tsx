"use client";
import { useStore } from "@/lib/store";
import { computeParking } from "@/lib/calc/parking";
import { fmt0 } from "@/lib/format";
import type { ParkingLevel, OtherUse } from "@/lib/types";

export default function ParkingTab() {
  const project = useStore((s) => s.project);
  const upsertP = useStore((s) => s.upsertParking);
  const removeP = useStore((s) => s.removeParking);
  const upsertU = useStore((s) => s.upsertOtherUse);
  const removeU = useStore((s) => s.removeOtherUse);
  const r = computeParking(project);

  return (
    <div className="grid gap-4">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="section-title">Parking inventory</h2>
            <p className="section-sub">Spaces available by level. Standard + PRM/accessible.</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => upsertP({ id: `pk-${Date.now()}`, name: "New level", standard: 0, prm: 0 })}
          >+ Add level</button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Level</th>
              <th className="text-right">Standard</th>
              <th className="text-right">PRM / accessible</th>
              <th className="text-right">Total</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {project.parking.map((p) => (
              <tr key={p.id}>
                <td><input className="cell-input" value={p.name} onChange={(e) => upsertP({ ...p, name: e.target.value })} /></td>
                <td><input type="number" min={0} className="cell-input text-right" value={p.standard} onChange={(e) => upsertP({ ...p, standard: Math.max(0, Math.round(parseFloat(e.target.value) || 0)) })} /></td>
                <td><input type="number" min={0} className="cell-input text-right" value={p.prm} onChange={(e) => upsertP({ ...p, prm: Math.max(0, Math.round(parseFloat(e.target.value) || 0)) })} /></td>
                <td className="text-right font-medium">{fmt0(p.standard + p.prm)}</td>
                <td><input className="cell-input" value={p.notes ?? ""} onChange={(e) => upsertP({ ...p, notes: e.target.value })} /></td>
                <td className="text-right"><button className="btn btn-danger text-xs" onClick={() => removeP(p.id)}>Delete</button></td>
              </tr>
            ))}
            <tr className="font-semibold bg-slate-50">
              <td>TOTAL</td>
              <td className="text-right">{fmt0(r.availableStandard)}</td>
              <td className="text-right">{fmt0(r.availablePRM)}</td>
              <td className="text-right">{fmt0(r.availableTotal)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="section-title">Other uses (optional)</h2>
        <p className="section-sub mb-4">Retail, F&B, etc. with parking ratios per 100 m².</p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Use</th>
              <th className="text-right">Net area (m²)</th>
              <th className="text-right">Spaces / 100 m²</th>
              <th className="text-right">Required</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {project.otherUses.map((u: OtherUse) => (
              <tr key={u.id}>
                <td><input className="cell-input" value={u.name} onChange={(e) => upsertU({ ...u, name: e.target.value })} /></td>
                <td><input type="number" step={0.01} className="cell-input text-right" value={u.netArea} onChange={(e) => upsertU({ ...u, netArea: parseFloat(e.target.value) || 0 })} /></td>
                <td><input type="number" step={0.1} className="cell-input text-right" value={u.spacesPer100sqm} onChange={(e) => upsertU({ ...u, spacesPer100sqm: parseFloat(e.target.value) || 0 })} /></td>
                <td className="text-right">{(u.netArea * u.spacesPer100sqm / 100).toFixed(1)}</td>
                <td className="text-right"><button className="btn btn-danger text-xs" onClick={() => removeU(u.id)}>Delete</button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={5}>
                <button className="btn btn-secondary text-xs" onClick={() => upsertU({ id: `ou-${Date.now()}`, name: "New use", netArea: 0, spacesPer100sqm: 0 })}>+ Add other use</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="section-title">Required vs available</h2>
        <table className="tbl">
          <thead>
            <tr><th>Category</th><th className="text-right">Units</th><th className="text-right">Spaces / unit</th><th className="text-right">Required</th></tr>
          </thead>
          <tbody>
            {r.requiredByCategory.map((rc) => (
              <tr key={rc.category}>
                <td>{rc.category}</td>
                <td className="text-right">{fmt0(rc.units)}</td>
                <td className="text-right">{rc.ratio}</td>
                <td className="text-right">{fmt0(rc.required)}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-slate-50">
              <td colSpan={3}>Residential required</td>
              <td className="text-right">{fmt0(r.requiredTotal)}</td>
            </tr>
            {r.otherUsesTotal > 0 && (
              <tr><td colSpan={3}>Other uses required</td><td className="text-right">{fmt0(r.otherUsesTotal)}</td></tr>
            )}
            <tr className="font-semibold bg-slate-50">
              <td colSpan={3}>TOTAL REQUIRED</td>
              <td className="text-right">{fmt0(r.grandRequired)}</td>
            </tr>
            <tr>
              <td colSpan={3}>Of which PRM ({(project.prmPercent * 100).toFixed(0)}%)</td>
              <td className="text-right">{fmt0(r.requiredPRM)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="kpi"><span className="kpi-label">Total balance</span><span className={`kpi-value ${r.grandBalance < 0 ? "text-red-600" : "text-emerald-700"}`}>{r.grandBalance > 0 ? "+" : ""}{fmt0(r.grandBalance)}</span><span className="kpi-sub">Available − required</span></div>
          <div className="kpi"><span className="kpi-label">PRM balance</span><span className={`kpi-value ${r.prmBalance < 0 ? "text-red-600" : "text-emerald-700"}`}>{r.prmBalance > 0 ? "+" : ""}{fmt0(r.prmBalance)}</span><span className="kpi-sub">PRM available − required</span></div>
          <div className="kpi"><span className="kpi-label">Compliance</span><span className={`kpi-value ${r.grandBalance < 0 || r.prmBalance < 0 ? "text-red-600" : "text-emerald-700"}`}>{r.grandBalance >= 0 && r.prmBalance >= 0 ? "OK" : "SHORT"}</span><span className="kpi-sub">Total + PRM</span></div>
        </div>
      </div>
    </div>
  );
}
