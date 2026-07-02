"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt0 } from "@/lib/format";
import {
  residentialGFATarget,
  residentialSubQuota,
} from "@/lib/calc/gfa";
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

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Distribution · residential GFA → apartments / common areas</h2>
          <p className="section-sub">
            Reparte el GFA residencial entre <strong>Amenities</strong>, <strong>Circulation</strong>{" "}
            y lo que queda para <strong>Apartments</strong>. <strong>Services</strong> (MEP, shafts,
            plant rooms…) también se introduce como % del GFA residencial pero solo cuenta como{" "}
            <strong>BUA</strong> (no como GFA) y no reduce la cuota de Apartments. El Apartments GFA
            que sale aquí alimenta luego Typologies y Apartments.
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
