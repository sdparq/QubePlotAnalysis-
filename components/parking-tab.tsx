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
              POD (People of Determination) follows Dubai DCD: 2% of the standard total up
              to 500 (min 1), then +1% on each additional space — added on top of the
              standard total, not carved out of it. The total parking surface is estimated
              by multiplying the combined required spaces by the average{" "}
              <strong>m² / parking space</strong>.
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
            uses are added below; POD (People of Determination) spaces are computed from
            the standard total and added on top — not a subset of it.
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
              <tr className="row-subtotal">
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Standard spaces required</td>
                <td className="text-right">{fmt0(r.grandRequired)}</td>
              </tr>
              <tr className="row-subtotal">
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">
                  + POD (Dubai DCD tiered rule, additional)
                </td>
                <td className="text-right">{fmt0(r.requiredPOD)}</td>
              </tr>
              <tr className="row-total">
                <td colSpan={4} className="text-right uppercase tracking-[0.10em] text-[11px]">Total spaces required</td>
                <td className="text-right">{fmt0(r.grandRequiredWithPOD)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Parking surface</h2>
          <p className="section-sub">
            Estimated built area required to fit all parking spaces and how it compares to
            the basement footprint available (= basement footprint × number of basements, from
            Setup). The basement footprint defaults to the full plot area — override it below
            if the basement covers less (setbacks, a shared party wall, etc).
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <Stat
            label="Total spaces"
            value={fmt0(r.grandRequiredWithPOD)}
            sub={`${fmt0(r.grandRequired)} std + ${fmt0(r.requiredPOD)} POD`}
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
        </div>

        {(() => {
          const plotArea = project.plotArea ?? 0;
          const basementFootprint = project.basementFootprintM2 ?? plotArea;
          const basementCount = project.basements?.count ?? 0;
          const basementHeightM = project.basements?.heightM ?? 3.0;
          // Ground and podium parking surfaces — independent, specific inputs.
          // Ground is a flat m² figure (ground is normally a single level);
          // podium is per-floor, multiplied by Setup's podium.count.
          const groundParking = Math.max(0, project.groundParkingM2 ?? 0);
          const podiumParkingPerFloor = Math.max(0, project.podiumParkingPerFloorM2 ?? 0);
          const podiumCount = project.podium?.count ?? 0;
          const podiumParkingSurface = podiumParkingPerFloor * podiumCount;
          const aboveGroundSurface = groundParking + podiumParkingSurface;
          const basementSurface = basementFootprint * basementCount;
          const availTotal = basementSurface + aboveGroundSurface;
          const required = r.totalParkingSurfaceM2;
          const balance = availTotal - required;
          const enough = balance >= 0 && availTotal > 0;
          const basementsNeededAlone = basementFootprint > 0 ? Math.ceil(required / basementFootprint) : 0;
          // How many basements are actually needed GIVEN what's already
          // planned for ground/podium parking — the number this card
          // answers. Read-only suggestion; Setup → Floor breakdown remains
          // the source of truth for basementCount (a click here syncs it).
          const remainingForBasements = Math.max(0, required - aboveGroundSurface);
          const basementsNeeded = basementFootprint > 0 && remainingForBasements > 0
            ? Math.ceil(remainingForBasements / basementFootprint)
            : 0;
          const basementsMatch = basementCount === basementsNeeded;
          function applyBasementsNeeded() {
            patch({ basements: { count: basementsNeeded, heightM: basementHeightM } });
          }
          return (
            <>
              <div className="grid gap-2">
                {/* Basements needed — headline answer */}
                <div className="border border-ink-200 bg-white p-3 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="eyebrow text-ink-500 text-[10px]">Basements needed</div>
                    <div className={`text-[22px] font-light tabular-nums mt-0.5 ${basementsMatch ? "text-emerald-700" : "text-amber-700"}`}>
                      {basementFootprint > 0 ? basementsNeeded : "—"}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">
                      {basementFootprint > 0
                        ? `${fmt0(remainingForBasements)} m² left to cover ÷ ${fmt0(basementFootprint)} m² basement footprint, after ${fmt0(aboveGroundSurface)} m² already planned in ground/podium.`
                        : "Set Plot area in Setup to compute this."}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-ink-500">
                      Configured in Setup: <strong className="text-ink-900">{basementCount}</strong>
                    </div>
                    {!basementsMatch && basementFootprint > 0 && (
                      <button className="btn btn-primary btn-xs mt-1" onClick={applyBasementsNeeded}>
                        Apply {basementsNeeded} basement{basementsNeeded === 1 ? "" : "s"}
                      </button>
                    )}
                    {basementsMatch && basementFootprint > 0 && (
                      <div className="text-[10.5px] text-emerald-700 mt-1">✓ matches Setup</div>
                    )}
                  </div>
                </div>
                {/* Inputs row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="border border-ink-200 bg-white p-3">
                    <div className="eyebrow text-ink-500 text-[10px]">Plot area (basement)</div>
                    <div className="text-[18px] font-light tabular-nums text-ink-900 mt-0.5">
                      {plotArea > 0 ? `${fmt0(plotArea)} m²` : "—"}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">
                      {plotArea > 0 ? fmtSqft(plotArea) : "Set in Setup"}
                    </div>
                    <label className="block mt-2 pt-2 border-t border-ink-100">
                      <span className="text-[10px] uppercase tracking-[0.08em] text-ink-500">Replace with (m²)</span>
                      <input
                        type="number"
                        step={10}
                        min={0}
                        className="cell-input text-right !text-[14px] tabular-nums mt-1 w-full"
                        value={project.basementFootprintM2 ?? ""}
                        placeholder={plotArea > 0 ? fmt0(plotArea) : "0"}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          patch({ basementFootprintM2: Number.isFinite(n) && n >= 0 ? n : undefined });
                        }}
                        title="Override the basement footprint per level, if it covers less than the full plot (setbacks, shared party wall, etc). Leave empty to use the full plot area."
                      />
                    </label>
                    <div className="text-[10.5px] text-ink-500 mt-1 leading-snug">
                      Leave empty to use the full plot footprint
                    </div>
                  </div>
                  <Stat
                    label="Basements"
                    value={`${basementCount}`}
                    sub={basementCount > 0 ? `${project.basements?.heightM ?? 0} m height each` : "Set in Setup → Floor breakdown"}
                  />
                  <div className="border border-ink-200 bg-white p-3">
                    <div className="eyebrow text-ink-500 text-[10px]">Ground floor parking (m²)</div>
                    <input
                      type="number"
                      step={10}
                      min={0}
                      className="cell-input text-right !text-[18px] font-light tabular-nums mt-0.5 w-full"
                      value={groundParking || ""}
                      placeholder="0"
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        patch({ groundParkingM2: Number.isFinite(n) && n >= 0 ? n : undefined });
                      }}
                      title="Surface on the ground floor dedicated to parking, if any. Leave 0 if the ground floor has no parking."
                    />
                    <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">
                      Leave 0 if none
                    </div>
                  </div>
                  <div className="border border-ink-200 bg-white p-3">
                    <div className="eyebrow text-ink-500 text-[10px]">Podium parking per floor (m²)</div>
                    <input
                      type="number"
                      step={10}
                      min={0}
                      className="cell-input text-right !text-[18px] font-light tabular-nums mt-0.5 w-full"
                      value={podiumParkingPerFloor || ""}
                      placeholder="0"
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        patch({ podiumParkingPerFloorM2: Number.isFinite(n) && n >= 0 ? n : undefined });
                      }}
                      title="Surface dedicated to parking on each podium floor, if any. Multiplied by the podium level count from Setup."
                    />
                    <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">
                      × {podiumCount} podium level{podiumCount === 1 ? "" : "s"} (Setup)
                    </div>
                  </div>
                </div>
                {/* Surface availability row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat
                    label="Avail. in basements"
                    value={basementSurface > 0 ? `${fmt0(basementSurface)} m²` : "—"}
                    sub={basementSurface > 0 ? `${fmt0(basementFootprint)} × ${basementCount}` : ""}
                  />
                  <Stat
                    label="Avail. in ground + podium"
                    value={aboveGroundSurface > 0 ? `${fmt0(aboveGroundSurface)} m²` : "—"}
                    sub={aboveGroundSurface > 0 ? `${fmt0(groundParking)} ground + ${fmt0(podiumParkingSurface)} podium` : ""}
                  />
                  <Stat
                    label="Total available"
                    value={availTotal > 0 ? `${fmt0(availTotal)} m²` : "—"}
                    sub={availTotal > 0 ? fmtSqft(availTotal) : ""}
                  />
                  <BalanceStat value={balance} ok={enough} unset={availTotal === 0} />
                </div>
              </div>

              {required > 0 && (
                <div className={`text-[12px] mt-3 leading-snug ${enough ? "text-emerald-700" : "text-amber-900"}`}>
                  {availTotal === 0 ? (
                    <>
                      No basements, ground or podium parking set yet. To fit the{" "}
                      {fmt0(required)} m² of parking you could:
                      <ul className="list-disc ml-5 mt-1">
                        {basementFootprint > 0 && <li><strong>{basementsNeededAlone}</strong> basement{basementsNeededAlone === 1 ? "" : "s"} alone (basement footprint of {fmt0(basementFootprint)} m²)</li>}
                        <li>or some combination of ground floor parking and podium parking (per floor) above</li>
                        <li>or any mix — set basements in <em>Setup → Floor breakdown</em>.</li>
                      </ul>
                    </>
                  ) : enough ? (
                    <>
                      ✓ Total available <strong>{fmt0(availTotal)} m²</strong> ({basementCount} basement{basementCount === 1 ? "" : "s"} + {fmt0(aboveGroundSurface)} m² ground/podium) covers the {fmt0(required)} m² required with a <strong>{fmt0(balance)} m²</strong> margin.
                      {basementSurface >= required && aboveGroundSurface > 0 && (
                        <> · You could fit it all in the basements alone ({fmt0(basementSurface)} m²) and free ground/podium for amenities or retail.</>
                      )}
                    </>
                  ) : (
                    <>
                      Available <strong>{fmt0(availTotal)} m²</strong> falls{" "}
                      <strong>{fmt0(-balance)} m² short</strong> of {fmt0(required)} m² required.{" "}
                      You&apos;d need either <strong>{basementsNeededAlone}</strong> basement{basementsNeededAlone === 1 ? "" : "s"}{" "}
                      alone (full plot), more ground/podium parking surface, or a mix that adds up to {fmt0(required)} m².
                    </>
                  )}
                </div>
              )}
            </>
          );
        })()}
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

function BalanceStat({ value, ok, unset }: { value: number; ok: boolean; unset: boolean }) {
  const color = unset ? "text-ink-400" : ok ? "text-emerald-700" : "text-red-700";
  const label = "Surface balance";
  const display = unset ? "—" : `${value >= 0 ? "+" : ""}${fmt0(value)} m²`;
  const sub = unset ? "Add basements in Setup" : ok ? "Fits within basements ✓" : "Short of required";
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className={`text-[18px] font-light tabular-nums mt-0.5 ${color}`}>{display}</div>
      <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>
    </div>
  );
}
