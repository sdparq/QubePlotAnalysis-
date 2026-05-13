"use client";
import { useStore, useProject } from "@/lib/store";
import { computeParking } from "@/lib/calc/parking";
import { fmt0 } from "@/lib/format";
import type { OtherUse } from "@/lib/types";

export default function ParkingTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const upsertP = useStore((s) => s.upsertParking);
  const removeP = useStore((s) => s.removeParking);
  const upsertU = useStore((s) => s.upsertOtherUse);
  const removeU = useStore((s) => s.removeOtherUse);
  const upsertTypology = useStore((s) => s.upsertTypology);
  const r = computeParking(project);

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Parking inventory</h2>
            <p className="section-sub">Spaces available by level (standard + PRM / accessible).</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="grid gap-1">
              <span className="eyebrow text-ink-500 text-[10.5px]">Retail parking · spaces / m²</span>
              <input
                type="number"
                step={0.05}
                min={0}
                className="cell-input text-right w-28"
                value={Number((project.retailParkingPerM2 ?? 1).toFixed(2))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) patch({ retailParkingPerM2: n });
                }}
                title="Required spaces per m² of retail GFA (from Setup → Retail). Default 1 space / m²."
              />
            </label>
            <button className="btn btn-primary" onClick={() => upsertP({ id: `pk-${Date.now()}`, name: "New level", standard: 0, prm: 0 })}>+ Add level</button>
          </div>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 80 }} />
              <col />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Level</th>
                <th className="text-right">Standard</th>
                <th className="text-right">PRM</th>
                <th className="text-right">Total</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {project.parking.map((p) => (
                <tr key={p.id}>
                  <td className="cell-edit"><input className="cell-input" value={p.name} onChange={(e) => upsertP({ ...p, name: e.target.value })} /></td>
                  <td className="cell-edit"><input type="number" min={0} className="cell-input text-right" value={p.standard} onChange={(e) => upsertP({ ...p, standard: Math.max(0, Math.round(parseFloat(e.target.value) || 0)) })} /></td>
                  <td className="cell-edit"><input type="number" min={0} className="cell-input text-right" value={p.prm} onChange={(e) => upsertP({ ...p, prm: Math.max(0, Math.round(parseFloat(e.target.value) || 0)) })} /></td>
                  <td className="text-right font-medium">{fmt0(p.standard + p.prm)}</td>
                  <td className="cell-edit"><input className="cell-input" value={p.notes ?? ""} onChange={(e) => upsertP({ ...p, notes: e.target.value })} /></td>
                  <td className="text-right"><button className="btn btn-danger btn-xs" onClick={() => removeP(p.id)}>Delete</button></td>
                </tr>
              ))}
              <tr className="row-total">
                <td>TOTAL</td>
                <td className="text-right">{fmt0(r.availableStandard)}</td>
                <td className="text-right">{fmt0(r.availablePRM)}</td>
                <td className="text-right">{fmt0(r.availableTotal)}</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Other uses (optional)</h2>
            <p className="section-sub">Retail, F&B, etc. with parking ratios per 100 m².</p>
          </div>
          <button className="btn btn-secondary btn-xs" onClick={() => upsertU({ id: `ou-${Date.now()}`, name: "New use", netArea: 0, spacesPer100sqm: 0 })}>+ Add other use</button>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 80 }} />
            </colgroup>
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
              {project.otherUses.length === 0 && (
                <tr><td colSpan={5} className="italic text-ink-500 text-center py-4">No other uses defined.</td></tr>
              )}
              {project.otherUses.map((u: OtherUse) => (
                <tr key={u.id}>
                  <td className="cell-edit"><input className="cell-input" value={u.name} onChange={(e) => upsertU({ ...u, name: e.target.value })} /></td>
                  <td className="cell-edit"><input type="number" step={0.01} className="cell-input text-right" value={u.netArea} onChange={(e) => upsertU({ ...u, netArea: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="cell-edit"><input type="number" step={0.1} className="cell-input text-right" value={u.spacesPer100sqm} onChange={(e) => upsertU({ ...u, spacesPer100sqm: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="text-right">{(u.netArea * u.spacesPer100sqm / 100).toFixed(1)}</td>
                  <td className="text-right"><button className="btn btn-danger btn-xs" onClick={() => removeU(u.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Required vs available</h2>
          <p className="section-sub">
            Each typology contributes its own ratio (set in Typologies). Retail comes from
            Setup → GFA breakdown × {Number((project.retailParkingPerM2 ?? 1).toFixed(2))}{" "}
            spaces / m². PRM follows Dubai DCD:{" "}
            <strong>2% of total up to 500 (min 1)</strong>, then{" "}
            <strong>+1% on each additional space</strong>.
          </p>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Typology</th>
                <th className="text-right">Category</th>
                <th className="text-right">Units</th>
                <th className="text-right">Spaces / unit</th>
                <th className="text-right">Required</th>
              </tr>
            </thead>
            <tbody>
              {r.requiredByTypology.map((rt) => (
                <tr key={rt.typology.id}>
                  <td className="font-medium text-ink-900">{rt.typology.name}</td>
                  <td className="text-right text-ink-500 text-xs">{rt.typology.category}</td>
                  <td className="text-right">{fmt0(rt.units)}</td>
                  <td className="cell-edit">
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      className="cell-input text-right"
                      value={rt.ratio}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        upsertTypology({
                          ...rt.typology,
                          parkingPerUnit: Number.isFinite(v) && v >= 0 ? v : 0,
                        });
                      }}
                    />
                  </td>
                  <td className="text-right">{fmt0(rt.required)}</td>
                </tr>
              ))}
              <tr className="row-subtotal">
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Residential required</td>
                <td className="text-right">{fmt0(r.requiredTotal)}</td>
              </tr>
              {r.retailRequired > 0 && (
                <tr className="row-subtotal">
                  <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">
                    Retail required ({fmt0(r.retailM2)} m² × {r.retailRateUsed.toFixed(2)})
                  </td>
                  <td className="text-right">{fmt0(r.retailRequired)}</td>
                </tr>
              )}
              {r.otherUsesTotal > 0 && (
                <tr className="row-subtotal">
                  <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Other uses required</td>
                  <td className="text-right">{fmt0(r.otherUsesTotal)}</td>
                </tr>
              )}
              <tr className="row-total">
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Total required</td>
                <td className="text-right">{fmt0(r.grandRequired)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="text-right text-ink-500 text-xs">
                  Of which PRM (Dubai DCD tiered rule)
                </td>
                <td className="text-right">{fmt0(r.requiredPRM)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {r.requiredByCategory.length > 0 && (
          <div className="mt-5">
            <div className="eyebrow text-ink-500 mb-2">Summary by category</div>
            <table className="tbl w-full table-fixed">
              <colgroup>
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Avg ratio</th>
                  <th className="text-right">Required</th>
                </tr>
              </thead>
              <tbody>
                {r.requiredByCategory.map((rc) => (
                  <tr key={rc.category}>
                    <td className="font-medium text-ink-900">{rc.category}</td>
                    <td className="text-right">{fmt0(rc.units)}</td>
                    <td className="text-right tabular-nums">{rc.ratio.toFixed(2)}</td>
                    <td className="text-right">{fmt0(rc.required)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="kpi">
            <span className="kpi-label">Total balance</span>
            <span className={`kpi-value ${r.grandBalance < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.grandBalance > 0 ? "+" : ""}{fmt0(r.grandBalance)}</span>
            <span className="kpi-sub">Available − required</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">PRM balance</span>
            <span className={`kpi-value ${r.prmBalance < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.prmBalance > 0 ? "+" : ""}{fmt0(r.prmBalance)}</span>
            <span className="kpi-sub">PRM available − required</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Compliance</span>
            <span className={`kpi-value ${r.grandBalance < 0 || r.prmBalance < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.grandBalance >= 0 && r.prmBalance >= 0 ? "OK" : "SHORT"}</span>
            <span className="kpi-sub">Total + PRM</span>
          </div>
        </div>
      </div>
    </div>
  );
}
