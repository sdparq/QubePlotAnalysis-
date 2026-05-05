"use client";
import { useStore } from "@/lib/store";
import { analyze } from "@/lib/calc";
import { fmt0, fmt2, fmtPct } from "@/lib/format";

export default function ResultsTab() {
  const project = useStore((s) => s.project);
  const r = analyze(project);
  const p = r.program, k = r.parking, l = r.lifts, g = r.garbage;

  const compliance: { label: string; ok: boolean; detail: string }[] = [
    { label: "Parking total", ok: k.grandBalance >= 0, detail: `${fmt0(k.availableTotal)} available vs ${fmt0(k.grandRequired)} required (${k.grandBalance >= 0 ? "+" : ""}${fmt0(k.grandBalance)})` },
    { label: "PRM parking", ok: k.prmBalance >= 0, detail: `${fmt0(k.availablePRM)} PRM available vs ${fmt0(k.requiredPRM)} required` },
    { label: "Lifts (CIBSE + practical)", ok: l.liftsRecommended > 0, detail: `Recommended ${l.liftsRecommended} (${l.governing})` },
    { label: "Garbage room", ok: g.roomAreaM2 > 0, detail: `${g.containers} containers × 2.5 m³ in ${fmt2(g.roomAreaM2)} m² (${fmt2(g.roomWidthM)} × ${fmt2(g.roomDepthM)})` },
  ];

  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Plot area" value={`${fmt2(project.plotArea)} m²`} />
        <Kpi label="Total GFA" value={`${fmt2(p.totalGFABuilding)} m²`} sub={`FAR ${p.far.toFixed(2)}`} />
        <Kpi label="Units" value={fmt0(p.totalUnits)} />
        <Kpi label="Sellable" value={`${fmt2(p.totalSellable)} m²`} sub={`${fmtPct(p.totalSellable / (p.totalGFABuilding || 1))} of GFA`} />
        <Kpi label="Population" value={fmt0(l.totalPopulation)} sub="from typology occupancy" />
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="section-title">Parking</h3>
          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
            <Stat label="Available total" value={fmt0(k.availableTotal)} />
            <Stat label="Required total" value={fmt0(k.grandRequired)} />
            <Stat label="Available PRM" value={fmt0(k.availablePRM)} />
            <Stat label="Required PRM" value={fmt0(k.requiredPRM)} />
            <Stat label="Balance" value={(k.grandBalance >= 0 ? "+" : "") + fmt0(k.grandBalance)} good={k.grandBalance >= 0} />
            <Stat label="PRM balance" value={(k.prmBalance >= 0 ? "+" : "") + fmt0(k.prmBalance)} good={k.prmBalance >= 0} />
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Lifts</h3>
          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
            <Stat label="Demand 5%" value={fmt0(l.demandStandard)} />
            <Stat label="Demand 7%" value={fmt0(l.demandPremium)} />
            <Stat label="Capacity / lift" value={fmt0(l.capacityPerLift)} />
            <Stat label="RTT" value={`${l.rttSeconds.toFixed(1)} s`} />
            <Stat label="CIBSE governs" value={fmt0(l.liftsCIBSE)} />
            <Stat label="Recommended" value={fmt0(l.liftsRecommended)} good />
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Garbage room (Dubai DM)</h3>
          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
            <Stat label="Daily waste" value={`${fmt2(g.dailyWasteKg)} kg`} />
            <Stat label="Storage 2 days" value={`${fmt2(g.storageKg)} kg`} />
            <Stat label="Volume" value={`${fmt2(g.volumeRequiredM3)} m³`} />
            <Stat label="Containers" value={fmt0(g.containers)} />
            <Stat label="Room dims" value={`${fmt2(g.roomWidthM)} × ${fmt2(g.roomDepthM)} m`} />
            <Stat label="Room area" value={`${fmt2(g.roomAreaM2)} m²`} good />
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">GFA efficiency</h3>
          <div className="grid grid-cols-1 gap-1 mt-2 text-sm">
            <EffRow label="Residential interior (net of shafts)" value={p.efficiency.residentialNetGFA} pct={p.efficiency.residentialNetPct} />
            <EffRow label="Circulation (lobby, corridors, lifts)" value={p.efficiency.circulationGFA} pct={p.efficiency.circulationPct} />
            <EffRow label="Services / MEP" value={p.efficiency.servicesGFA} pct={p.efficiency.servicesPct} />
            <EffRow label="Amenities (GFA)" value={p.efficiency.amenitiesGFAarea} pct={p.efficiency.amenitiesPct} />
            <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between font-semibold">
              <span>Total GFA</span><span>{fmt2(p.totalGFABuilding)} m²</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">Balconies (non-GFA): {fmt2(p.efficiency.balconiesNonGFA)} m² · Amenities (non-GFA, open air): {fmt2(p.efficiency.amenitiesNonGFA)} m²</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="section-title">Compliance summary</h3>
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          {compliance.map((c) => (
            <div key={c.label} className="flex items-start gap-3 p-3 rounded-md border border-slate-200">
              <span className={c.ok ? "tag-ok" : "tag-bad"}>{c.ok ? "OK" : "REVIEW"}</span>
              <div>
                <div className="font-medium text-sm">{c.label}</div>
                <div className="text-xs text-slate-500">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
        {project.notes && (
          <div className="mt-4 text-sm whitespace-pre-wrap p-3 bg-slate-50 rounded-md border border-slate-200">
            <div className="font-medium mb-1">Notes</div>
            {project.notes}
          </div>
        )}
      </section>
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
function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <>
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-medium ${good === true ? "text-emerald-700" : good === false ? "text-red-600" : ""}`}>{value}</span>
    </>
  );
}
function EffRow({ label, value, pct }: { label: string; value: number; pct: number }) {
  return (
    <div className="flex justify-between gap-2 items-center">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-700">{fmt2(value)} m² · {fmtPct(pct)}</span>
    </div>
  );
}
