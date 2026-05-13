"use client";
import { useStore, useProject } from "@/lib/store";
import { computeParking } from "@/lib/calc/parking";
import { fmt0 } from "@/lib/format";
import type { OtherUse } from "@/lib/types";

const M2_TO_SQFT = 10.7639;
function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  return `${Math.round(m2 * M2_TO_SQFT).toLocaleString("en-US")} sqft`;
}

export default function ParkingTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const upsertU = useStore((s) => s.upsertOtherUse);
  const removeU = useStore((s) => s.removeOtherUse);
  const upsertTypology = useStore((s) => s.upsertTypology);
  const r = computeParking(project);

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Parking parameters</h2>
            <p className="section-sub">
              Retail comes from Setup → GFA breakdown ÷ <strong>m² per space</strong>.
              PRM follows Dubai DCD: 2% of total up to 500 (min 1), then +1% on each
              additional space. The total parking surface is estimated by multiplying
              required spaces by the average <strong>m² / parking space</strong>.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-[320px]">
            <label className="grid gap-1">
              <span className="eyebrow text-ink-500 text-[10.5px]">Retail · m² per space</span>
              <input
                type="number"
                step={5}
                min={1}
                className="cell-input text-right"
                value={Number((project.retailM2PerSpace ?? 70).toFixed(0))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n > 0) patch({ retailM2PerSpace: n });
                }}
                title="m² of retail GFA per required parking space (default 70 = 1 space per 70 m² of retail)"
              />
            </label>
            <label className="grid gap-1">
              <span className="eyebrow text-ink-500 text-[10.5px]">Parking · m² per space</span>
              <input
                type="number"
                step={1}
                min={1}
                className="cell-input text-right"
                value={Number((project.m2PerParkingSpace ?? 25).toFixed(0))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n > 0) patch({ m2PerParkingSpace: n });
                }}
                title="Built area consumed by one parking space, including aisles and ramps (default 25 m²)"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Other uses (optional)</h2>
            <p className="section-sub">F&amp;B, clinics, offices, etc. with their own parking ratio per 100 m².</p>
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
          <h2 className="section-title">Required parking</h2>
          <p className="section-sub">
            Each typology contributes its own ratio (set in Typologies). Retail and other
            uses are added below; PRM is computed from the grand total.
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
                    Retail required ({fmt0(r.retailM2)} m² ÷ {fmt0(r.retailM2PerSpaceUsed)} m²/space)
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
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Total spaces required</td>
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
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Parking surface</h2>
          <p className="section-sub">
            Estimated built area required to fit all parking spaces — useful to size
            basements / podium parking levels.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Total spaces"
            value={fmt0(r.grandRequired)}
            sub={`${fmt0(r.requiredPRM)} of which PRM`}
          />
          <Stat
            label="m² / space"
            value={`${fmt0(r.m2PerParkingSpaceUsed)} m²`}
            sub="Aisles, ramps included"
          />
          <Stat
            label="Total parking surface"
            value={`${fmt0(r.totalParkingSurfaceM2)} m²`}
            sub={fmtSqft(r.totalParkingSurfaceM2)}
          />
          <Stat
            label="Per basement (if 1)"
            value={`${fmt0(r.totalParkingSurfaceM2)} m²`}
            sub="Split across N basements as needed"
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className="text-[18px] font-light tabular-nums text-ink-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
