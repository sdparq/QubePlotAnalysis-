"use client";
import { useStore } from "@/lib/store";
import { computeLifts } from "@/lib/calc/lifts";
import { fmt0, fmt2 } from "@/lib/format";

export default function LiftsTab() {
  const project = useStore((s) => s.project);
  const patch = useStore((s) => s.patch);
  const r = computeLifts(project);
  const cfg = project.lifts;

  return (
    <div className="grid gap-4">
      <div className="card">
        <h2 className="section-title">Lift configuration (CIBSE Guide D)</h2>
        <p className="section-sub mb-4">Cabin, speed and operating parameters used in the round-trip-time calculation.</p>
        <div className="grid sm:grid-cols-3 gap-4">
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
          <Field label="Rule of thumb: units / lift">
            <input type="number" step={1} className="cell-input" value={cfg.unitsPerLiftRule} onChange={(e) => patch({ lifts: { ...cfg, unitsPerLiftRule: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) } })} />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Population by floor</h2>
        <table className="tbl">
          <thead><tr><th>Floor</th><th className="text-right">Units</th><th className="text-right">Population</th></tr></thead>
          <tbody>
            {r.byFloor.map((f) => (
              <tr key={f.floor}><td>Floor {f.floor}</td><td className="text-right">{fmt0(f.units)}</td><td className="text-right">{fmt2(f.population)}</td></tr>
            ))}
            <tr className="font-semibold bg-slate-50"><td>TOTAL</td><td className="text-right">{fmt0(r.totalUnits)}</td><td className="text-right">{fmt2(r.totalPopulation)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="section-title">RTT and capacity</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Total travel height" value={`${fmt2(r.totalTravelHeight)} m`} sub={`${project.numFloors} floors × ${project.floorHeight} m`} />
          <Kpi label="Probable stops" value={r.probableStops.toFixed(1)} sub="√N" />
          <Kpi label="RTT" value={`${r.rttSeconds.toFixed(1)} s`} sub="2H/v + stops × 8s" />
          <Kpi label="Trips per 5 min" value={r.tripsPer5Min.toFixed(1)} sub="300 / RTT" />
          <Kpi label="Persons / trip (80%)" value={fmt0(r.personsPerTrip)} sub={`Cabin ${cfg.cabinKg} kg`} />
          <Kpi label="Capacity / lift in 5 min" value={fmt0(r.capacityPerLift)} sub="Trips × persons" />
          <Kpi label="Demand standard 5%" value={fmt0(r.demandStandard)} sub="People in 5 min" />
          <Kpi label="Demand premium 7%" value={fmt0(r.demandPremium)} sub="People in 5 min" />
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Lifts required</h2>
        <table className="tbl">
          <thead><tr><th>Criterion</th><th className="text-right">Lifts</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>CIBSE standard 5%</td><td className="text-right">{fmt0(r.liftsCIBSEStandard)}</td><td>ceil({fmt0(r.demandStandard)} / {fmt0(r.capacityPerLift)})</td></tr>
            <tr><td>CIBSE premium 7%</td><td className="text-right">{fmt0(r.liftsCIBSEPremium)}</td><td>ceil({fmt0(r.demandPremium)} / {fmt0(r.capacityPerLift)})</td></tr>
            <tr><td>Rule of thumb (1 per {cfg.unitsPerLiftRule} units)</td><td className="text-right">{fmt0(r.ruleOfThumbLifts)}</td><td>{fmt0(r.totalUnits)} units</td></tr>
            <tr><td>DCD minimum (≥{cfg.dcdMinUnitsThreshold} units)</td><td className="text-right">{fmt0(r.dcdMinLifts)}</td><td>Dubai code</td></tr>
            <tr className="font-semibold bg-emerald-50">
              <td>RECOMMENDED</td>
              <td className="text-right text-2xl">{fmt0(r.liftsRecommended)}</td>
              <td>{r.governing}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1"><span className="text-xs font-medium text-slate-600">{label}</span>{children}</label>;
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
