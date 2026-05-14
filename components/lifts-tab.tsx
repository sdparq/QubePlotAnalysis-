"use client";
import { useStore, useProject } from "@/lib/store";
import { computeLifts } from "@/lib/calc/lifts";
import { fmt0, fmt2 } from "@/lib/format";

export default function LiftsTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const r = computeLifts(project);
  const cfg = project.lifts;

  const basementCount = project.basements?.count ?? 0;
  const groundCount = project.ground?.count ?? 1;
  const podiumCount = project.podium?.count ?? 0;
  const defaultBoardingFloors = Math.max(1, basementCount + groundCount + podiumCount);

  return (
    <div className="grid gap-6">
      {/* DBC D.8.8 — primary recommendation */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Dubai Building Code · D.8.8 Passenger elevators</h2>
          <p className="section-sub">
            Minimum number of elevators for residential apartments derived from Figure D.13
            (population) + Figure D.14 (boarding floors). Uses Table D.5 for occupancy.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Kpi
            label="Population"
            value={fmt0(r.totalPopulation)}
            sub={`${fmt0(r.totalUnits)} units · per Table D.5`}
          />
          <Kpi
            label="Occupied floors"
            value={`${r.occupiedFloors}`}
            sub="Type / residential floors"
          />
          <Kpi
            label="Boarding floors"
            value={`${r.boardingFloors}`}
            sub={`Default: ${basementCount}B + ${groundCount}G + ${podiumCount}P = ${defaultBoardingFloors}`}
          />
          <Kpi
            label="D.8.8 minimum"
            value={r.dbcTotal !== null ? `${r.dbcTotal} lifts` : "Out of chart"}
            sub={r.dbcTotal !== null ? `${r.dbcFromPopulation} pop + ${r.dbcFromBoarding} board` : "VT consultant"}
          />
        </div>

        <label className="grid gap-1 max-w-[220px]">
          <span className="eyebrow">Boarding floors override</span>
          <input
            type="number"
            min={1}
            step={1}
            className="cell-input text-right"
            value={r.boardingFloors}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1) patch({ dbcBoardingFloors: n });
              else if (e.target.value === "") patch({ dbcBoardingFloors: undefined });
            }}
          />
          <span className="text-[10.5px] text-ink-500">
            Number of floors with elevator stops (basements, ground, podium). Auto-derived
            from Setup → Floor breakdown unless you set it here.
          </span>
        </label>

        {r.dbcOutOfChart && (
          <p className="text-[12px] text-amber-900 mt-3 leading-snug">
            ⚠ Population ({fmt0(r.totalPopulation)}), occupied floors ({r.occupiedFloors})
            or boarding floors ({r.boardingFloors}) fall outside Figures D.13 / D.14. Per
            D.8.4, a VT Consultant must design the system using Method 2 (D.9).
          </p>
        )}
      </div>

      {/* Min cabin specifications — Table D.6 */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Cabin specifications · Table D.6</h2>
          <p className="section-sub">
            Minimum and recommended elevator specifications for residential buildings,
            depending on the number of occupied floors. Match these on procurement.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <SpecCard
            title="Passenger elevator"
            sub={r.passengerMin.description}
            spec={r.passengerMin}
            recommended={r.occupiedFloors > 10 ? r.passengerRecommended : null}
          />
          <SpecCard
            title="Service elevator"
            sub="At least one service elevator advised"
            spec={r.serviceMin}
            recommended={r.serviceRecommended}
          />
        </div>
      </div>

      {/* Population breakdown */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Population by floor</h2>
          <p className="section-sub">Per Table D.5 — the population total drives Figure D.13.</p>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead><tr><th>Floor</th><th className="text-right">Units</th><th className="text-right">Population</th></tr></thead>
            <tbody>
              {r.byFloor.map((f) => (
                <tr key={f.floor}><td className="font-medium text-ink-900">Floor {f.floor}</td><td className="text-right">{fmt0(f.units)}</td><td className="text-right">{fmt2(f.population)}</td></tr>
              ))}
              <tr className="row-total"><td>TOTAL</td><td className="text-right">{fmt0(r.totalUnits)}</td><td className="text-right">{fmt2(r.totalPopulation)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* CIBSE Guide D — secondary check */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">CIBSE Guide D · handling-capacity check</h2>
          <p className="section-sub">
            Round-trip-time analysis as a cross-check against the D.8.8 minimum. The final
            recommendation below uses whichever method gives the higher number.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-5 mb-5">
          <Field label="Cabin rated load (kg)">
            <select className="cell-input" value={cfg.cabinKg} onChange={(e) => patch({ lifts: { ...cfg, cabinKg: parseInt(e.target.value, 10) as 1000 | 1275 | 1600 } })}>
              <option value={1000}>1000 kg</option>
              <option value={1275}>1275 kg</option>
              <option value={1600}>1600 kg</option>
            </select>
          </Field>
          <Field label="Speed (m/s)">
            <input type="number" step={0.05} className="cell-input" value={cfg.speed} onChange={(e) => patch({ lifts: { ...cfg, speed: parseFloat(e.target.value) || 0 } })} />
          </Field>
          <Field label="Time per stop (s)">
            <input type="number" step={0.5} className="cell-input" value={cfg.timePerStop} onChange={(e) => patch({ lifts: { ...cfg, timePerStop: parseFloat(e.target.value) || 0 } })} />
          </Field>
          <Field label="Standard handling %">
            <input type="number" step={0.5} className="cell-input" value={cfg.handlingPctStandard * 100} onChange={(e) => patch({ lifts: { ...cfg, handlingPctStandard: (parseFloat(e.target.value) || 0) / 100 } })} />
          </Field>
          <Field label="Premium handling %">
            <input type="number" step={0.5} className="cell-input" value={cfg.handlingPctPremium * 100} onChange={(e) => patch({ lifts: { ...cfg, handlingPctPremium: (parseFloat(e.target.value) || 0) / 100 } })} />
          </Field>
          <Field label="Rule of thumb · units / lift">
            <input type="number" step={1} className="cell-input" value={cfg.unitsPerLiftRule} onChange={(e) => patch({ lifts: { ...cfg, unitsPerLiftRule: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) } })} />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Total travel height" value={`${fmt2(r.totalTravelHeight)} m`} sub={`${project.numFloors} floors × ${project.floorHeight} m`} />
          <Kpi label="Probable stops" value={r.probableStops.toFixed(1)} sub="√N" />
          <Kpi label="RTT" value={`${r.rttSeconds.toFixed(1)} s`} sub={`2H/v + stops × ${cfg.timePerStop} s`} />
          <Kpi label="Trips per 5 min" value={r.tripsPer5Min.toFixed(1)} sub="300 / RTT" />
          <Kpi label="Persons / trip @ 80%" value={fmt0(r.personsPerTrip)} sub={`Cabin ${cfg.cabinKg} kg`} />
          <Kpi label="Capacity / lift in 5 min" value={fmt0(r.capacityPerLift)} sub="Trips × persons" />
          <Kpi label="Demand standard 5%" value={fmt0(r.demandStandard)} sub="People in 5 min" />
          <Kpi label="Demand premium 7%" value={fmt0(r.demandPremium)} sub="People in 5 min" />
        </div>
      </div>

      {/* Final recommendation */}
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Lifts required — final</h2>
          <p className="section-sub">Recommended count = max of Dubai D.8.8 minimum and the CIBSE / rule-of-thumb checks.</p>
        </div>
        <div>
          <table className="tbl w-full table-fixed">
            <colgroup>
              <col />
              <col style={{ width: 130 }} />
              <col style={{ width: "40%" }} />
            </colgroup>
            <thead><tr><th>Criterion</th><th className="text-right">Lifts</th><th>Notes</th></tr></thead>
            <tbody>
              <tr>
                <td>Dubai Building Code · D.8.8</td>
                <td className="text-right">{r.dbcTotal !== null ? fmt0(r.dbcTotal) : "—"}</td>
                <td className="text-ink-500 text-xs">
                  {r.dbcTotal !== null
                    ? `${r.dbcFromPopulation} (population) + ${r.dbcFromBoarding} (boarding)`
                    : "Out of chart — VT consultant required"}
                </td>
              </tr>
              <tr>
                <td>CIBSE standard 5%</td>
                <td className="text-right">{fmt0(r.liftsCIBSEStandard)}</td>
                <td className="text-ink-500 text-xs">ceil({fmt0(r.demandStandard)} ÷ {fmt0(r.capacityPerLift)})</td>
              </tr>
              <tr>
                <td>CIBSE premium 7%</td>
                <td className="text-right">{fmt0(r.liftsCIBSEPremium)}</td>
                <td className="text-ink-500 text-xs">ceil({fmt0(r.demandPremium)} ÷ {fmt0(r.capacityPerLift)})</td>
              </tr>
              <tr>
                <td>Rule of thumb (1 per {cfg.unitsPerLiftRule} units)</td>
                <td className="text-right">{fmt0(r.ruleOfThumbLifts)}</td>
                <td className="text-ink-500 text-xs">{fmt0(r.totalUnits)} units</td>
              </tr>
              <tr className="row-total">
                <td>RECOMMENDED</td>
                <td className="text-right text-2xl text-qube-700 font-semibold">{fmt0(r.liftsRecommended)}</td>
                <td className="text-ink-700 text-xs uppercase tracking-wider">{r.governing}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2"><span className="eyebrow">{label}</span>{children}</label>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className="text-[18px] font-light tabular-nums text-ink-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

function SpecCard({
  title, sub, spec, recommended,
}: {
  title: string;
  sub: string;
  spec: ReturnType<typeof computeLifts>["passengerMin"];
  recommended: ReturnType<typeof computeLifts>["passengerRecommended"] | null;
}) {
  return (
    <div className="border border-ink-200 p-4 grid gap-3">
      <div>
        <div className="text-[14px] font-medium text-ink-900">{title}</div>
        <div className="text-[10.5px] text-ink-500">{sub}</div>
      </div>
      <SpecBlock label={spec.category === "min" ? "Minimum" : "Recommended"} spec={spec} />
      {recommended && spec.ratedKg !== recommended.ratedKg && (
        <SpecBlock label="Recommended" spec={recommended} highlight />
      )}
    </div>
  );
}

function SpecBlock({
  label, spec, highlight,
}: {
  label: string;
  spec: ReturnType<typeof computeLifts>["passengerMin"];
  highlight?: boolean;
}) {
  return (
    <div className={`border ${highlight ? "border-qube-300 bg-qube-50" : "border-ink-100 bg-bone-50/50"} p-2.5 grid gap-1`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`eyebrow text-[10px] ${highlight ? "text-qube-700" : "text-ink-500"}`}>{label}</span>
        <span className="text-[11px] tabular-nums text-ink-900">
          <strong>{spec.ratedKg} kg</strong> · {spec.persons} persons
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-700 tabular-nums">
        <span>Cabin: <strong>{spec.cabinW_mm} × {spec.cabinD_mm}</strong> mm</span>
        <span>Height: <strong>{spec.cabinH_mm}</strong> mm</span>
        <span>Door: <strong>{spec.doorW_mm} × {spec.doorH_mm}</strong> mm</span>
      </div>
      <div className="text-[10px] text-ink-500">{spec.doorType}</div>
    </div>
  );
}
