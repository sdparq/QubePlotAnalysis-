"use client";
import { useEffect, useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { fmt0 } from "@/lib/format";
import {
  residentialGFATarget,
  residentialSubQuota,
} from "@/lib/calc/gfa";
import { computeTowerYield } from "@/lib/calc/tower-yield";
import { computeOffices, computeOfficeStack, type OfficeStackResult } from "@/lib/calc/offices";
import type { OfficeStack } from "@/lib/types";
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
  const offices = useMemo(() => computeOffices(project), [project]);
  const officeStack = useMemo(() => computeOfficeStack(project), [project]);

  // Keep the persisted tower floor count in sync so Program / Parking / Lifts
  // / Massing — which all read project.typeFloors.count / project.numFloors
  // directly — pick up the derived value without their own copy of this calc.
  useEffect(() => {
    if (yield_.towerFootprintM2 <= 0 || yield_.towerTargetGFA <= 0) return;
    const nextCount = Math.max(1, yield_.towerFloors);
    const curHeight = project.typeFloors?.heightM ?? project.floorHeight;
    if ((project.typeFloors?.count ?? project.numFloors) === nextCount) return;
    patch({
      typeFloors: { count: nextCount, heightM: curHeight },
      numFloors: nextCount,
      floorHeight: curHeight > 0 ? curHeight : project.floorHeight,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yield_.towerFloors, yield_.towerFootprintM2, yield_.towerTargetGFA]);

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

      <OfficeDistributionCard
        offices={offices}
        onPatch={(next) =>
          patch({ officeBreakdown: { ...project.officeBreakdown, ...next } })
        }
      />

      {offices.officeGFA > 0 && (
        <OfficePlacementCard
          stack={officeStack}
          podiumCount={project.podium?.count ?? 0}
          podiumFootprintM2={project.podiumFootprintM2 ?? 0}
          towerFootprintM2={project.towerFootprintM2 ?? 0}
          officeGFA={offices.officeGFA}
          residentialFloors={project.typeFloors?.count ?? project.numFloors}
          groundCount={project.ground?.count ?? 1}
          basementCount={project.basements?.count ?? 0}
          onPatch={(next) => patch({ officeStack: { ...project.officeStack, ...next } })}
        />
      )}
    </div>
  );
}

/** Commercial / Office GFA → circulation + services + net lettable offices
 *  (the office GSA). Mirrors the residential card; offices have no balconies. */
function OfficeDistributionCard({
  offices: o,
  onPatch,
}: {
  offices: ReturnType<typeof computeOffices>;
  onPatch: (next: { circulationPct?: number; servicesPct?: number }) => void;
}) {
  const over = o.circulationPct + o.servicesPct > 100;
  return (
    <div className="card">
      <div className="mb-5">
        <h2 className="section-title">Distribution · office GFA → offices / common areas</h2>
        <p className="section-sub">
          For mixed schemes. Splits the <strong>Commercial / Office</strong> GFA from Setup between{" "}
          <strong>Circulation</strong> (cores, lobbies, corridors), <strong>Services</strong> (MEP,
          shafts, toilets) and what remains for <strong>Offices</strong> — the net lettable area, which
          is the office <strong>GSA</strong> (offices carry no balconies). All three sit inside the
          office GFA. Office parking is then required at 1 space per {fmt0(o.m2PerSpace)} m² of office
          GSA (editable in Parking).
        </p>
      </div>

      {o.officeGFA <= 0 ? (
        <div className="border border-ink-200 bg-bone-50 text-ink-700 p-3 text-[12.5px] leading-snug">
          No office use in this project. Add <strong>Commercial / Office</strong> in Setup&apos;s GFA
          breakdown to distribute it here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Office GFA" value={`${fmt0(o.officeGFA)} m²`} sub={fmtSqft(o.officeGFA)} />
            <Stat label="Offices GSA (net)" value={`${fmt0(o.net)} m²`} sub={`${o.netPct.toFixed(1)}% of office GFA`} />
            <Stat label="Σ Cores" value={`${fmt0(o.circulation + o.services)} m²`} sub={`${(o.circulationPct + o.servicesPct).toFixed(1)}% of office GFA`} />
            <Stat label="Office parking" value={`${fmt0(o.parkingRequired)} spaces`} sub={`GSA ÷ ${fmt0(o.m2PerSpace)} m²/space`} />
          </div>

          <div className="border border-ink-200">
            <div className="grid grid-cols-[1fr_140px_120px_140px] gap-2 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
              <div>Group</div>
              <div className="text-right">% of office</div>
              <div className="text-right">m²</div>
              <div className="text-right">≈ sqft</div>
            </div>
            <GroupRow
              label="Circulation"
              hint="Cores, lobbies, lift halls, corridors."
              value={o.circulationPct}
              m2={o.circulation}
              kind="GFA"
              onChange={(v) => onPatch({ circulationPct: Math.max(0, v) })}
            />
            <GroupRow
              label="Services"
              hint="MEP rooms, shafts, toilets, plant rooms — inside the office GFA."
              value={o.servicesPct}
              m2={o.services}
              kind="GFA"
              onChange={(v) => onPatch({ servicesPct: Math.max(0, v) })}
            />
            <div className="grid grid-cols-[1fr_140px_120px_140px] gap-2 items-center px-3 py-2.5 bg-qube-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-ink-900">Offices (net lettable)</span>
                  <span className="px-1.5 py-0 text-[9.5px] uppercase tracking-[0.10em] border bg-qube-700 text-white border-qube-700">GSA</span>
                </div>
                <div className="text-[10.5px] text-ink-500 leading-snug mt-0.5">100 − circulation − services. No balconies.</div>
              </div>
              <div className="text-right text-ink-700 tabular-nums">{o.netPct.toFixed(1)}%</div>
              <div className="text-right font-medium text-qube-800 tabular-nums">{fmt0(o.net)} m²</div>
              <div className="text-right text-[11px] text-ink-500 tabular-nums">{fmtSqft(o.net)}</div>
            </div>
          </div>
          {over && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-3 text-[12px] leading-snug mt-3">
              Circulation + services exceed 100 % of the office GFA — no net office area is left.
            </div>
          )}
        </>
      )}
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
        <h2 className="section-title">Tower floors · residential GFA − ground − podium</h2>
        <p className="section-sub">
          Enter each tier's footprint as you know it from your own zoning study —
          it is not derived from the Massing plot (to avoid dragging tracing errors along). The
          tower floor count comes from dividing the residential GFA <strong>minus the ground-floor
          and podium surfaces</strong> by the <strong>tower footprint</strong> — what the base
          absorbs doesn&apos;t need tower floors; Ground and Podium are informative, to cross-check
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
        <Stat
          label="GFA to tower"
          value={y.towerTargetGFA > 0 ? `${fmt0(y.towerTargetGFA)} m²` : "—"}
          sub={
            y.groundGFA + y.podiumGFA > 0
              ? `residential − ground ${fmt0(y.groundGFA)} − podium ${fmt0(y.podiumFootprintM2 * Math.max(0, y.podiumCount - y.podiumOfficeLevels))} m²` +
                (y.podiumOfficeLevels > 0 ? ` (${y.podiumOfficeLevels} office podium level${y.podiumOfficeLevels === 1 ? "" : "s"} left out)` : "")
              : "residential (no ground/podium plates set)"
          }
        />
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
          label="Residential tower floors"
          value={y.towerFootprintM2 > 0 ? `${fmt0(y.towerFloors)}` : "—"}
          sub={y.exceedsMax ? "clamped to the max" : "floors of the Apartments matrix"}
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
          <strong>{fmt0(y.towerGFA)} m²</strong> of the <strong>{fmt0(y.towerTargetGFA)} m²</strong>
          headed for the tower fits — <strong>{fmt0(y.gfaShort)} m²</strong> short ({y.floorsShort} floor
          {y.floorsShort === 1 ? "" : "s"}). Reduce the residential GFA in Setup, enlarge the ground/tower
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
            className="cell-input text-right !py-1 !pl-1 !pr-6 w-[110px]"
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

/** Where the offices go: podium levels, tower floors (bottom or top) and their
 *  height — plus a floor-by-floor section of the whole building. */
function OfficePlacementCard({
  stack, podiumCount, podiumFootprintM2, towerFootprintM2, officeGFA,
  residentialFloors, groundCount, basementCount, onPatch,
}: {
  stack: OfficeStackResult;
  podiumCount: number;
  podiumFootprintM2: number;
  towerFootprintM2: number;
  officeGFA: number;
  residentialFloors: number;
  groundCount: number;
  basementCount: number;
  onPatch: (next: Partial<OfficeStack>) => void;
}) {
  const levels = new Set(stack.podiumLevels);
  function toggleLevel(l: number) {
    const next = new Set(levels);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    onPatch({ podiumLevels: Array.from(next).sort((a, b) => a - b) });
  }
  const drift = stack.placementDrift;
  return (
    <div className="card">
      <div className="mb-5">
        <h2 className="section-title">Offices · where they go</h2>
        <p className="section-sub">
          Choose the podium levels and the tower floors that hold the offices. Office tower floors are
          stacked on top of the residential ones (below or above them) — the Apartments matrix keeps
          covering only the residential floors, and the 3D massing, heights and lifts follow.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        <div className="grid gap-4">
          <div className="border border-ink-200">
            <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 eyebrow text-ink-600 text-[10px]">Podium levels</div>
            <div className="p-3 grid gap-2">
              {podiumCount <= 0 ? (
                <p className="text-[12px] text-ink-500">No podium levels in Setup → Floor breakdown.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Podium levels used by offices">
                    {Array.from({ length: podiumCount }, (_, i) => i + 1).map((l) => (
                      <button
                        key={l}
                        type="button"
                        aria-pressed={levels.has(l)}
                        onClick={() => toggleLevel(l)}
                        className={`h-8 min-w-[52px] px-2 text-[11px] font-medium uppercase tracking-[0.08em] border transition-colors ${
                          levels.has(l)
                            ? "bg-[#8e5bd0] border-[#8e5bd0] text-white"
                            : "bg-white border-ink-200 text-ink-700 hover:border-ink-400"
                        }`}
                        title={levels.has(l) ? `P${l}: offices — click to give it back to the podium` : `P${l}: podium (parking / amenities) — click to make it offices`}
                      >P{l}</button>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink-500 leading-snug">
                    {levels.size > 0
                      ? podiumFootprintM2 > 0
                        ? `${levels.size} level${levels.size === 1 ? "" : "s"} × ${fmt0(podiumFootprintM2)} m² podium footprint = ${fmt0(stack.podiumGFA)} m² of offices. These levels are no longer taken off the residential GFA.`
                        : "Set the podium footprint in Tower floors above so these levels count towards the office GFA."
                      : "Click a level to give it to offices (purple)."}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="border border-ink-200">
            <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 eyebrow text-ink-600 text-[10px]">Tower floors</div>
            <div className="p-3 grid sm:grid-cols-3 gap-3">
              <label className="grid gap-1 content-start">
                <span className="eyebrow text-ink-500 text-[10px]">Office floors</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="cell-input text-right"
                  value={stack.manualTowerFloors ? stack.towerFloors : ""}
                  placeholder={`auto · ${stack.autoTowerFloors}`}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    const n = parseFloat(v);
                    onPatch({ towerFloors: v === "" || !Number.isFinite(n) ? undefined : Math.max(0, Math.round(n)) });
                  }}
                />
                <span className="text-[10.5px] text-ink-500 leading-snug">
                  {stack.manualTowerFloors
                    ? "Fixed — clear the field to go back to automatic."
                    : towerFootprintM2 > 0
                      ? `Auto: ${fmt0(stack.remainingGFA)} m² ÷ ${fmt0(towerFootprintM2)} m² plate, rounded up.`
                      : "Auto needs the tower footprint (Tower floors above)."}
                </span>
              </label>
              <div className="grid gap-1 content-start">
                <span className="eyebrow text-ink-500 text-[10px]">Position</span>
                <div className="seg w-full grid grid-cols-2">
                  <button className="seg-btn" data-active={stack.towerPosition === "bottom"} onClick={() => onPatch({ towerPosition: "bottom" })}>Bottom</button>
                  <button className="seg-btn" data-active={stack.towerPosition === "top"} onClick={() => onPatch({ towerPosition: "top" })}>Top</button>
                </div>
                <span className="text-[10.5px] text-ink-500 leading-snug">
                  {stack.towerPosition === "bottom" ? "Right above the podium, apartments over them." : "Above the apartments, at the top of the tower."}
                </span>
              </div>
              <label className="grid gap-1 content-start">
                <span className="eyebrow text-ink-500 text-[10px]">Office floor height (m)</span>
                <input
                  type="number"
                  min={2.5}
                  step={0.1}
                  className="cell-input text-right"
                  value={Number(stack.heightM.toFixed(2))}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (Number.isFinite(n) && n > 0) onPatch({ heightM: n });
                  }}
                />
                <span className="text-[10.5px] text-ink-500 leading-snug">Floor-to-floor; residential uses Setup&apos;s type-floor height.</span>
              </label>
            </div>
          </div>

          {stack.needsTowerFootprint ? (
            <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12px] leading-snug">
              {fmt0(stack.remainingGFA)} m² of offices still need tower floors — enter the tower footprint in
              Tower floors above, or type the number of office floors.
            </div>
          ) : (
            <div className={`border p-3 text-[12px] leading-snug ${Math.abs(drift) > Math.max(1, officeGFA * 0.05) ? "border-amber-200 bg-amber-50 text-amber-900" : "border-ink-200 bg-bone-50 text-ink-700"}`}>
              Office GFA {fmt0(officeGFA)} m² → placed {fmt0(stack.podiumGFA + stack.towerGFA)} m²
              {stack.podiumGFA > 0 ? ` (podium ${fmt0(stack.podiumGFA)} + tower ${fmt0(stack.towerGFA)})` : ` in ${stack.towerFloors} tower floor${stack.towerFloors === 1 ? "" : "s"}`}
              {Math.abs(drift) > 1 && (
                <strong> · {drift > 0 ? "+" : ""}{fmt0(drift)} m² {drift > 0 ? "spare" : "short"}</strong>
              )}
              .
            </div>
          )}
        </div>

        <FloorStack
          basementCount={basementCount}
          groundCount={groundCount}
          podiumCount={podiumCount}
          podiumOfficeLevels={levels}
          residentialFloors={residentialFloors}
          officeFloors={stack.towerFloors}
          officeOnTop={stack.towerPosition === "top"}
        />
      </div>
    </div>
  );
}

const USE_COLORS = {
  offices: "#8e5bd0",
  residential: "#1baf7a",
  podium: "#2a78d6",
  ground: "#eb6834",
  basement: "#9aa3b2",
} as const;

/** Section of the building, top to bottom, one band per run of floors with the same use. */
function FloorStack({
  basementCount, groundCount, podiumCount, podiumOfficeLevels, residentialFloors, officeFloors, officeOnTop,
}: {
  basementCount: number;
  groundCount: number;
  podiumCount: number;
  podiumOfficeLevels: Set<number>;
  residentialFloors: number;
  officeFloors: number;
  officeOnTop: boolean;
}) {
  type Band = { name: string; use: keyof typeof USE_COLORS; label: string; floors: number };
  const bands: Band[] = [];
  const range = (p: string, a: number, b: number) => (a === b ? `${p}${a}` : `${p}${a}–${p}${b}`);
  // Tower, top first. L1 = first tower floor above the podium.
  const res = Math.max(0, residentialFloors);
  const off = Math.max(0, officeFloors);
  if (officeOnTop) {
    if (off > 0) bands.push({ name: range("L", res + 1, res + off), use: "offices", label: "Offices", floors: off });
    if (res > 0) bands.push({ name: range("L", 1, res), use: "residential", label: "Apartments", floors: res });
  } else {
    if (res > 0) bands.push({ name: range("L", off + 1, off + res), use: "residential", label: "Apartments", floors: res });
    if (off > 0) bands.push({ name: range("L", 1, off), use: "offices", label: "Offices", floors: off });
  }
  // Podium runs, top first.
  for (let l = podiumCount; l >= 1; ) {
    const office = podiumOfficeLevels.has(l);
    let k = l;
    while (k - 1 >= 1 && podiumOfficeLevels.has(k - 1) === office) k--;
    bands.push({ name: range("P", k, l), use: office ? "offices" : "podium", label: office ? "Offices" : "Podium · parking / amenities", floors: l - k + 1 });
    l = k - 1;
  }
  if (groundCount > 0) bands.push({ name: groundCount > 1 ? range("G", 1, groundCount) : "G", use: "ground", label: "Ground · lobby / retail", floors: groundCount });
  if (basementCount > 0) bands.push({ name: range("B", 1, basementCount), use: "basement", label: "Basements · parking", floors: basementCount });

  const total = bands.reduce((s, b) => s + b.floors, 0) || 1;
  return (
    <div className="border border-ink-200">
      <div className="px-3 py-2 bg-bone-50 border-b border-ink-200 eyebrow text-ink-600 text-[10px]">Floor stack</div>
      <div className="p-3 grid gap-px">
        {bands.map((b, i) => (
          <div key={i} className="flex items-stretch gap-2 text-[11.5px]">
            <div
              className="w-10 shrink-0"
              style={{ background: USE_COLORS[b.use], opacity: b.use === "basement" ? 0.55 : 1, minHeight: 18, height: Math.max(18, (b.floors / total) * 300) }}
            />
            <div className="flex-1 min-w-0 flex items-center justify-between gap-2 border-b border-ink-100">
              <span className="truncate"><strong className="font-medium text-ink-900 tabular-nums">{b.name}</strong> <span className="text-ink-600">{b.label}</span></span>
              <span className="text-ink-500 tabular-nums shrink-0">{b.floors}F</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}