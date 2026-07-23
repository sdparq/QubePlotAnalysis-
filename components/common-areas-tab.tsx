"use client";
import { useEffect, useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt0 } from "@/lib/format";
import {
  residentialGFATarget,
  residentialSubQuota,
} from "@/lib/calc/gfa";
import { computeTowerYield } from "@/lib/calc/tower-yield";
import {
  DEFAULT_RESIDENTIAL_BREAKDOWN,
  type CommonArea,
} from "@/lib/types";

const M2_TO_SQFT = 10.7639;
function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  return `${Math.round(m2 * M2_TO_SQFT).toLocaleString("en-US")} sqft`;
}

/** Build the flat CommonArea[] list the rest of the calc engine consumes.
 *   - Amenities, Circulation: category "GFA" (counts as GFA and BUA)
 *   - Services: category "BUA" (counts as BUA only) */
function buildFlatCommonAreas(opts: {
  amenitiesGFA: number;
  circulationGFA: number;
  servicesBUA: number;
}): CommonArea[] {
  return [
    { id: "ca-amenities",   name: "Amenities",   area: Number(opts.amenitiesGFA.toFixed(2)),   floors: 1, category: "GFA" },
    { id: "ca-circulation", name: "Circulation", area: Number(opts.circulationGFA.toFixed(2)), floors: 1, category: "GFA" },
    { id: "ca-services",    name: "Services",    area: Number(opts.servicesBUA.toFixed(2)),    floors: 1, category: "BUA" },
  ];
}

export default function CommonAreasTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);

  const rb = project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN;
  const amenitiesPct = rb.amenities?.pct ?? 0;
  const circulationPct = rb.circulation?.pct ?? 0;
  const servicesPct = rb.services?.pct ?? 0;
  const apartmentsPct = Math.max(0, 100 - amenitiesPct - circulationPct);

  const residentialGFA = useMemo(() => residentialGFATarget(project), [project]);
  const amenitiesGFA = residentialSubQuota(project, "amenities");
  const circulationGFA = residentialSubQuota(project, "circulation");
  const servicesM2 = residentialSubQuota(project, "services");

  function commit(next: { amenitiesPct?: number; circulationPct?: number; servicesPct?: number }) {
    const nextRb = {
      ...rb,
      amenities:   { ...rb.amenities,   pct: next.amenitiesPct   ?? amenitiesPct },
      circulation: { ...rb.circulation, pct: next.circulationPct ?? circulationPct },
      services:    { ...rb.services,    pct: next.servicesPct    ?? servicesPct },
    };
    const projectAfter = { ...project, residentialBreakdown: nextRb };
    patch({
      residentialBreakdown: nextRb,
      commonAreas: buildFlatCommonAreas({
        amenitiesGFA:   residentialSubQuota(projectAfter, "amenities"),
        circulationGFA: residentialSubQuota(projectAfter, "circulation"),
        servicesBUA:    residentialSubQuota(projectAfter, "services"),
      }),
    });
  }

  const apartmentsGFA = (apartmentsPct / 100) * residentialGFA;
  const totalCommonGFA = amenitiesGFA + circulationGFA;

  const yield_ = useMemo(() => computeTowerYield(project), [project]);

  // Keep the persisted tower floor count in sync so Program / Parking / Lifts
  // / Massing — which all read project.typeFloors.count / project.numFloors
  // directly — pick up the derived value without their own copy of this calc.
  useEffect(() => {
    if (yield_.towerFootprintM2 <= 0 || yield_.apartmentsGFA <= 0) return;
    const nextCount = Math.max(1, yield_.towerFloors);
    const curHeight = project.typeFloors?.heightM ?? project.floorHeight;
    if ((project.typeFloors?.count ?? project.numFloors) === nextCount) return;
    patch({
      typeFloors: { count: nextCount, heightM: curHeight },
      numFloors: nextCount,
      floorHeight: curHeight > 0 ? curHeight : project.floorHeight,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yield_.towerFloors, yield_.towerFootprintM2, yield_.apartmentsGFA]);

  function setFootprint(field: "groundFootprintM2" | "podiumFootprintM2" | "towerFootprintM2", v: number) {
    patch({ [field]: v > 0 ? v : undefined });
  }

  return (
    <div className="grid gap-6">
      <TowerYieldCard
        yield_={yield_}
        maxTowerFloors={project.maxTowerFloors}
        onSetFootprint={setFootprint}
        onSetMaxTowerFloors={(v) => patch({ maxTowerFloors: v > 0 ? v : undefined })}
      />

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Distribution · residential GFA → apartments / common areas</h2>
          <p className="section-sub">
            Splits the residential GFA between <strong>Amenities</strong>, <strong>Circulation</strong>{" "}
            and what remains for <strong>Apartments</strong>. <strong>Services</strong> (MEP, shafts,
            plant rooms…) is also entered as a % of residential GFA but only counts as{" "}
            <strong>BUA</strong> (not GFA) and does not reduce the Apartments quota. The Apartments GFA
            computed here then feeds Typologies and Apartments.
          </p>
        </div>

        {residentialGFA <= 0 && (
          <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12.5px] mb-4 leading-snug">
            Set <strong>Residential GFA</strong> in Setup&apos;s GFA breakdown to drive this table.
          </div>
        )}

        {residentialGFA > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <Stat label="Residential GFA" value={`${fmt0(residentialGFA)} m²`} sub={fmtSqft(residentialGFA)} />
            <Stat label="Apartments GFA" value={`${fmt0(apartmentsGFA)} m²`} sub={`${apartmentsPct.toFixed(1)}% of residential`} />
            <Stat label="Σ Common GFA" value={`${fmt0(totalCommonGFA)} m²`} sub={`${(amenitiesPct + circulationPct).toFixed(1)}% of residential`} />
          </div>
        )}

        <div className="border border-ink-200">
          {/* Header */}
          <div className="grid grid-cols-[1fr_140px_120px_140px] gap-2 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <div>Group</div>
            <div className="text-right">% of residential</div>
            <div className="text-right">m²</div>
            <div className="text-right">≈ sqft</div>
          </div>

          <GroupRow
            label="Amenities"
            hint="Indoor + outdoor amenity rooms (gym, lobby pool, sauna, kids, coworking…)."
            value={amenitiesPct}
            m2={amenitiesGFA}
            kind="GFA"
            onChange={(v) => commit({ amenitiesPct: Math.max(0, v) })}
          />
          <GroupRow
            label="Circulation"
            hint="Lobbies, corridors."
            value={circulationPct}
            m2={circulationGFA}
            kind="GFA"
            onChange={(v) => commit({ circulationPct: Math.max(0, v) })}
          />
          <GroupRow
            label="Services"
            hint="MEP rooms, shafts, ducts, plant rooms. % of residential GFA but only counts as BUA — does not reduce Apartments."
            value={servicesPct}
            m2={servicesM2}
            kind="BUA"
            onChange={(v) => commit({ servicesPct: Math.max(0, v) })}
          />
        </div>
      </div>
    </div>
  );
}

function TowerYieldCard({
  yield_, maxTowerFloors, onSetFootprint, onSetMaxTowerFloors,
}: {
  yield_: ReturnType<typeof computeTowerYield>;
  maxTowerFloors: number | undefined;
  onSetFootprint: (field: "groundFootprintM2" | "podiumFootprintM2" | "towerFootprintM2", v: number) => void;
  onSetMaxTowerFloors: (v: number) => void;
}) {
  const y = yield_;

  return (
    <div className="card">
      <div className="mb-4">
        <h2 className="section-title">Tower floors · from apartments GFA</h2>
        <p className="section-sub">
          Enter each tier's footprint as you know it from your own zoning study —
          it is not derived from the Massing plot (to avoid dragging tracing errors along). The
          tower floor count comes from dividing the <strong>apartments GFA</strong> (residential ×
          apartments %) by the <strong>tower footprint</strong> — the tower holds the apartments;
          amenities and services sit in the base; Ground and Podium are informative, to cross-check
          against Setup's retail/commercial.
        </p>
      </div>

      <div className="border border-ink-200 mb-4">
        <div className="grid grid-cols-[1fr_130px_70px_120px] gap-2 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
          <div>Tier</div>
          <div className="text-right">Footprint m² (manual)</div>
          <div className="text-right">Floors</div>
          <div className="text-right">GFA m²</div>
        </div>

        <FootprintRow
          label="Ground floor"
          hint="Informative — cross-check against Setup's retail/commercial."
          value={y.groundFootprintM2}
          floors={y.groundCount}
          gfa={y.groundGFA}
          onChange={(v) => onSetFootprint("groundFootprintM2", v)}
        />
        <FootprintRow
          label="Podium"
          hint={`Informative · × ${y.podiumCount} podium level(s) (Setup → Floor breakdown).`}
          value={y.podiumFootprintM2}
          floors={y.podiumCount}
          gfa={y.podiumGFA}
          onChange={(v) => onSetFootprint("podiumFootprintM2", v)}
        />
        <FootprintRow
          label="Tower (per floor)"
          hint="Drives the tower floor count — see below."
          value={y.towerFootprintM2}
          floors={y.towerFloors}
          gfa={y.towerGFA}
          highlight
          onChange={(v) => onSetFootprint("towerFootprintM2", v)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Apartments GFA" value={y.apartmentsGFA > 0 ? `${fmt0(y.apartmentsGFA)} m²` : "—"} sub="residential × apartments %" />
        <Stat label="Tower floors needed" value={y.towerFootprintM2 > 0 ? `${fmt0(y.requiredTowerFloors)}` : "—"} sub="uncapped" />
        <div className="border border-ink-200 bg-white p-3">
          <div className="eyebrow text-ink-500 text-[10px]">Max tower floors (zoning cap)</div>
          <input
            type="number"
            step={1}
            min={0}
            className="cell-input text-right !text-[18px] font-light tabular-nums mt-0.5 w-full"
            value={maxTowerFloors ?? ""}
            placeholder="unlimited"
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              onSetMaxTowerFloors(Number.isFinite(n) ? n : 0);
            }}
          />
          <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">Leave empty for unlimited</div>
        </div>
        <Stat
          label="Tower floors (final)"
          value={y.towerFootprintM2 > 0 ? `${fmt0(y.towerFloors)}` : "—"}
          sub={y.exceedsMax ? "clamped to the max" : "applied to the project"}
        />
      </div>

      {y.towerFootprintM2 <= 0 && (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12.5px] leading-snug">
          Enter the tower footprint per floor to compute how many floors are needed.
        </div>
      )}

      {y.exceedsMax && (
        <div className="border border-red-200 bg-red-50 text-red-700 p-3 text-[12px] leading-snug">
          With the <strong>{y.maxTowerFloors}</strong>-floor cap only{" "}
          <strong>{fmt0(y.towerGFA)} m²</strong> of the <strong>{fmt0(y.apartmentsGFA)} m²</strong> of
          apartments GFA fits — <strong>{fmt0(y.gfaShort)} m²</strong> short ({y.floorsShort} floor
          {y.floorsShort === 1 ? "" : "s"}). Reduce the residential GFA in Setup, trim the apartments share, enlarge the tower
          footprint, or raise the floor cap if the plot genuinely allows it.
        </div>
      )}
    </div>
  );
}

function FootprintRow({
  label, hint, value, floors, gfa, highlight, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  floors: number;
  gfa: number;
  highlight?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`grid grid-cols-[1fr_130px_70px_120px] gap-2 px-3 py-2.5 items-center text-[12px] tabular-nums border-b border-ink-100 last:border-b-0 ${highlight ? "bg-qube-50/40" : ""}`}>
      <div>
        <div className="text-ink-900">{label}</div>
        <div className="text-[10.5px] text-ink-500 leading-snug">{hint}</div>
      </div>
      <div className="text-right">
        <input
          type="number"
          step={10}
          min={0}
          className="cell-input text-right !py-1 !px-1.5 w-[120px]"
          value={value || ""}
          placeholder="0"
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
      </div>
      <div className="text-right text-ink-700">{floors > 0 ? floors : "—"}</div>
      <div className={`text-right font-medium ${highlight ? "text-qube-800" : "text-ink-900"}`}>
        {gfa > 0 ? Math.round(gfa).toLocaleString("en-US") : "—"}
      </div>
    </div>
  );
}

function GroupRow({
  label, hint, value, m2, kind, onChange,
}: {
  label: string;
  hint: string;
  value: number;
  m2: number;
  kind: "GFA" | "BUA";
  onChange: (v: number) => void;
}) {
  const kindClass =
    kind === "GFA"
      ? "bg-qube-500 text-white border-qube-500"
      : "bg-ink-900 text-white border-ink-900";
  return (
    <div className="grid grid-cols-[1fr_140px_120px_140px] gap-2 items-center px-3 py-2.5 border-b border-ink-100">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-ink-900">{label}</span>
          <span className={`px-1.5 py-0 text-[9.5px] uppercase tracking-[0.10em] border ${kindClass}`}>{kind}</span>
        </div>
        <div className="text-[10.5px] text-ink-500 leading-snug mt-0.5">{hint}</div>
      </div>
      <div className="text-right">
        <div className="relative inline-block">
          <input
            type="number"
            step={0.5}
            min={0}
            className="cell-input text-right pr-6 !py-1 !px-1.5 w-[110px]"
            value={Number(value.toFixed(2))}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= 0) onChange(n);
            }}
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">%</span>
        </div>
      </div>
      <div className="text-right text-ink-900 tabular-nums">
        {m2 > 0 ? `${Math.round(m2).toLocaleString("en-US")} m²` : "—"}
      </div>
      <div className="text-right text-[11px] text-ink-500 tabular-nums">{fmtSqft(m2)}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className="text-[18px] font-light text-ink-900 mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}
