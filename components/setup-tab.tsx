"use client";
import { useEffect, useMemo, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { DUBAI_ZONES } from "@/lib/standards/dubai";
import {
  DEFAULT_RESIDENTIAL_BREAKDOWN,
  type FloorSection,
  type GfaBreakdown,
  type GfaBreakdownItem,
  type GfaUseCategory,
  type ResidentialBreakdown,
  type ResidentialSubCategory,
} from "@/lib/types";
import { useZoneLibrary } from "@/lib/use-zone-library";
import {
  ALL_CLASS_LETTERS,
  TYPOLOGY_KEYS,
  TYPOLOGY_LABELS,
  allZoneNames,
  classForZone,
  type ZoneClass,
  type TypologyKey,
} from "@/lib/zone-classes";
import { residentialBuaInflationFactor, residentialSubBUA, residentialSubGFA } from "@/lib/calc/gfa";

interface FloorSectionDef {
  key: "basements" | "ground" | "podium" | "typeFloors";
  label: string;
  defaultCount: number;
  defaultHeight: number;
  hint: string;
}

const FLOOR_SECTIONS: FloorSectionDef[] = [
  { key: "basements", label: "Basements", defaultCount: 0, defaultHeight: 3.0, hint: "Below ground — usually parking, MEP." },
  { key: "ground", label: "Ground floor", defaultCount: 1, defaultHeight: 4.5, hint: "Lobby, retail, drop-off." },
  { key: "podium", label: "Podium", defaultCount: 0, defaultHeight: 4.0, hint: "Amenities, parking, retail above ground." },
  { key: "typeFloors", label: "Type floors", defaultCount: 8, defaultHeight: 3.2, hint: "Residential typical floors — drive the Program matrix." },
];

const M2_TO_SQFT = 10.7639;

function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  const sqft = m2 * M2_TO_SQFT;
  return `${Math.round(sqft).toLocaleString("en-US")} sqft`;
}

const GFA_CATEGORIES: { key: GfaUseCategory; label: string; hint: string }[] = [
  { key: "residential", label: "Residential", hint: "Apartments, villas, serviced apartments." },
  { key: "retail", label: "Retail", hint: "Shops, supermarkets, F&B." },
  { key: "commercial", label: "Commercial / Office", hint: "Offices, co-working, clinics." },
  { key: "hospitality", label: "Hospitality", hint: "Hotel keys, branded residence." },
];

export default function SetupTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const { library } = useZoneLibrary();

  // Union of legacy DUBAI_ZONES + every zone known to the class library, dedup.
  const zoneOptions = useMemo(() => {
    const set = new Set<string>([...DUBAI_ZONES, ...allZoneNames(library)]);
    const arr = Array.from(set);
    arr.sort((a, b) => a.localeCompare(b));
    return arr;
  }, [library]);

  const detectedClass: ZoneClass | null = useMemo(
    () => classForZone(project.zone, library),
    [project.zone, library],
  );

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Project</h2>
          <p className="section-sub">Identification and plot data.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="Project name">
            <input className="cell-input" value={project.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Dubai zone" hint={detectedClass ? `Class ${detectedClass} · ${library[detectedClass].name}` : "Unknown class"}>
            <select className="cell-input" value={project.zone} onChange={(e) => patch({ zone: e.target.value })}>
              {zoneOptions.map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Plot area (m²)" hint={`≈ ${fmtSqft(project.plotArea)}`}>
            <NumInput value={project.plotArea} onChange={(v) => patch({ plotArea: v })} />
          </Field>
          <Field label="Target GFA (m²)" hint={`≈ ${fmtSqft(project.targetGFA ?? 0)}`}>
            <NumInput
              value={project.targetGFA ?? 0}
              step={10}
              onChange={(v) => patch({ targetGFA: v > 0 ? v : undefined })}
            />
          </Field>
          <Field label="Latitude">
            <NumInput
              value={project.latitude ?? 0}
              step={0.0001}
              onChange={(v) => patch({ latitude: v !== 0 ? v : undefined })}
            />
          </Field>
          <Field label="Longitude">
            <NumInput
              value={project.longitude ?? 0}
              step={0.0001}
              onChange={(v) => patch({ longitude: v !== 0 ? v : undefined })}
            />
          </Field>
          <Field label="North heading (° clockwise of +Y)">
            <NumInput
              value={project.northHeadingDeg ?? 0}
              step={1}
              onChange={(v) => patch({ northHeadingDeg: v })}
            />
          </Field>
          <Field label="Ground elevation override (m)">
            <NumInput
              value={project.groundElevationM ?? 0}
              step={1}
              onChange={(v) => patch({ groundElevationM: v !== 0 ? v : undefined })}
            />
          </Field>
        </div>
        <p className="text-[11px] text-ink-500 mt-3">
          Target GFA powers the percentage input mode in Common Areas (leave 0 if you prefer m²). Latitude / longitude
          unlock the In-context Massing view that streams Google Photorealistic 3D Tiles around the plot.
        </p>
      </div>

      {detectedClass && (
        <DetectedClassCard letter={detectedClass} library={library} />
      )}

      <FloorBreakdownCard project={project} patch={patch} />

      <GfaBreakdownCard project={project} patch={patch} />
    </div>
  );
}

function DetectedClassCard({
  letter,
  library,
}: {
  letter: ZoneClass;
  library: ReturnType<typeof useZoneLibrary>["library"];
}) {
  const row = library[letter];
  // Natural typology order so Studio is shown first.
  const mixEntries = TYPOLOGY_KEYS
    .map((k) => ({ key: k, pct: row.typologyMix[k] }))
    .filter((m) => m.pct > 0.001);
  const summary = mixEntries
    .map((m) => `${(m.pct * 100).toFixed(0)}% ${TYPOLOGY_LABELS[m.key]}`)
    .join(" · ");
  return (
    <div className="card bg-qube-50 border-qube-200">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="text-[42px] font-light text-qube-700 tabular-nums leading-none">{letter}</div>
        <div className="flex-1 min-w-[280px]">
          <div className="eyebrow text-qube-800 text-[10px]">Detected class</div>
          <div className="text-[16px] font-medium text-ink-900 mt-0.5">{row.name}</div>
          <p className="text-[12px] text-ink-700 leading-snug mt-1">{row.description}</p>
          <div className="mt-3">
            <div className="eyebrow text-ink-500 text-[10px]">Recommended unit mix</div>
            <div className="text-[12.5px] text-ink-900 tabular-nums mt-1">{summary}</div>
            <div className="text-[10.5px] text-ink-500 mt-1.5">
              You can apply this mix in <strong>Typologies</strong> · floor heights in this
              class: ground {row.floorHeights.ground} m, podium {row.floorHeights.podium} m,
              typical {row.floorHeights.typical} m · parking {row.parkingAreaPerCarSqft} sqft/car.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FloorBreakdownCard({
  project,
  patch,
}: {
  project: ReturnType<typeof useProject>;
  patch: (p: Partial<ReturnType<typeof useProject>>) => void;
}) {
  function get(key: FloorSectionDef["key"], def: FloorSectionDef): FloorSection {
    const stored = project[key] as FloorSection | undefined;
    if (stored) return stored;
    // Defaults — for typeFloors fall back to the legacy fields so old projects
    // keep their values.
    if (key === "typeFloors") {
      return { count: project.numFloors || def.defaultCount, heightM: project.floorHeight || def.defaultHeight };
    }
    return { count: def.defaultCount, heightM: def.defaultHeight };
  }

  function setSection(key: FloorSectionDef["key"], partial: Partial<FloorSection>) {
    const def = FLOOR_SECTIONS.find((s) => s.key === key)!;
    const cur = get(key, def);
    const next: FloorSection = {
      count: Math.max(0, Math.round(partial.count ?? cur.count)),
      heightM: Math.max(0, partial.heightM ?? cur.heightM),
    };
    const updates: Partial<typeof project> = { [key]: next };
    // Keep legacy fields in sync — typeFloors drives numFloors / floorHeight so
    // the Program matrix and downstream calcs keep working.
    if (key === "typeFloors") {
      updates.numFloors = Math.max(1, next.count);
      updates.floorHeight = next.heightM > 0 ? next.heightM : project.floorHeight;
    }
    patch(updates);
  }

  const totalAboveGround = FLOOR_SECTIONS
    .filter((s) => s.key !== "basements")
    .reduce((sum, s) => sum + get(s.key, s).count, 0);
  const totalHeightAbove = FLOOR_SECTIONS
    .filter((s) => s.key !== "basements")
    .reduce((sum, s) => {
      const sec = get(s.key, s);
      return sum + sec.count * sec.heightM;
    }, 0);
  const basementSec = get("basements", FLOOR_SECTIONS[0]);

  return (
    <div className="card">
      <div className="mb-5">
        <h2 className="section-title">Floor breakdown</h2>
        <p className="section-sub">
          Tell the app how the building is stratified. Each section has its own number of
          floors and floor-to-floor height. Type floors drive the residential Program matrix.
        </p>
      </div>

      <div className="border border-ink-200">
        <div className="grid grid-cols-[1fr_90px_110px_110px] gap-1 px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
          <div>Section</div>
          <div className="text-right">Floors</div>
          <div className="text-right">Height (m)</div>
          <div className="text-right">Total height</div>
        </div>
        {FLOOR_SECTIONS.map((def) => {
          const sec = get(def.key, def);
          const totalH = sec.count * sec.heightM;
          return (
            <div
              key={def.key}
              className="grid grid-cols-[1fr_90px_110px_110px] gap-1 px-3 py-2 items-center text-[12px] tabular-nums border-b border-ink-100 last:border-b-0"
            >
              <div>
                <div className="text-ink-900">{def.label}</div>
                <div className="text-[10.5px] text-ink-500 leading-snug">{def.hint}</div>
              </div>
              <input
                type="number"
                step={1}
                min={0}
                className="cell-input text-right"
                value={sec.count}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setSection(def.key, { count: Number.isFinite(n) ? n : 0 });
                }}
              />
              <input
                type="number"
                step={0.1}
                min={0}
                className="cell-input text-right"
                value={Number(sec.heightM.toFixed(2))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setSection(def.key, { heightM: Number.isFinite(n) ? n : 0 });
                }}
              />
              <div className="text-right text-ink-900">
                {totalH > 0 ? `${totalH.toFixed(1)} m` : "—"}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[1fr_90px_110px_110px] gap-1 px-3 py-2 items-center text-[12px] tabular-nums bg-qube-50 font-medium">
          <div className="uppercase tracking-[0.08em] text-[10.5px] text-qube-800">
            Above ground (visible building)
          </div>
          <div className="text-right text-qube-800">{totalAboveGround}</div>
          <div></div>
          <div className="text-right text-qube-800">{totalHeightAbove.toFixed(1)} m</div>
        </div>
      </div>
      <p className="text-[11px] text-ink-500 mt-3 leading-snug">
        {basementSec.count > 0
          ? `Plus ${basementSec.count} basement level(s) — ${(basementSec.count * basementSec.heightM).toFixed(1)} m below ground.`
          : "No basements configured."}
      </p>
    </div>
  );
}

function GfaBreakdownCard({
  project,
  patch,
}: {
  project: ReturnType<typeof useProject>;
  patch: (p: Partial<ReturnType<typeof useProject>>) => void;
}) {
  const total = project.targetGFA ?? 0;
  const breakdown: GfaBreakdown = project.gfaBreakdown ?? {};

  function getItem(key: GfaUseCategory): GfaBreakdownItem {
    return breakdown[key] ?? { mode: "absolute", value: 0 };
  }

  function setItem(key: GfaUseCategory, partial: Partial<GfaBreakdownItem>) {
    const next: GfaBreakdown = { ...breakdown };
    const cur = getItem(key);
    next[key] = { ...cur, ...partial };
    patch({ gfaBreakdown: next });
  }

  function toggleMode(key: GfaUseCategory) {
    const cur = getItem(key);
    if (cur.mode === "absolute") {
      // m² → % (only meaningful when there is a total)
      const pct = total > 0 ? (cur.value / total) * 100 : 0;
      setItem(key, { mode: "percent", value: Number(pct.toFixed(2)) });
    } else {
      const m2 = (cur.value / 100) * total;
      setItem(key, { mode: "absolute", value: Number(m2.toFixed(2)) });
    }
  }

  function effectiveM2(key: GfaUseCategory): number {
    const item = getItem(key);
    return item.mode === "absolute" ? item.value : (item.value / 100) * total;
  }

  function effectivePct(key: GfaUseCategory): number {
    const item = getItem(key);
    if (item.mode === "percent") return item.value;
    return total > 0 ? (item.value / total) * 100 : 0;
  }

  /** Fraction of a use's built area (BUA) that counts toward GFA.
   *  For Residential we derive it from the inflation factor in the shared
   *  helper (which accounts for both residentialBreakdown flags AND the
   *  Common Areas sub-breakdown). For the others, 1. */
  function gfaShare(key: GfaUseCategory): number {
    if (key !== "residential") return 1;
    const inflation = residentialBuaInflationFactor(project);
    return inflation > 0 ? 1 / inflation : 1;
  }

  /** The user types the GFA target for each use. The BUA inflates above it
   *  whenever a sub-category is flagged Non-GFA (extra built area that doesn't
   *  count toward FAR). */
  function buaFor(key: GfaUseCategory): number {
    const share = gfaShare(key);
    const m2 = effectiveM2(key);
    return share > 0 ? m2 / share : m2;
  }

  function gfaFor(key: GfaUseCategory): number {
    return gfaShare(key) > 0 ? effectiveM2(key) : 0;
  }

  const sumBUA = GFA_CATEGORIES.reduce((s, c) => s + buaFor(c.key), 0);
  const sumGFA = GFA_CATEGORIES.reduce((s, c) => s + gfaFor(c.key), 0);
  const sumPctGFA = total > 0 ? (sumGFA / total) * 100 : 0;
  const gfaMismatch = total > 0 ? Math.abs(sumGFA - total) : 0;
  const gfaMismatchPct = total > 0 ? gfaMismatch / total : 0;

  function rebalanceTo100() {
    if (total <= 0) return;
    // Scale every BUA pro-rata so the resulting GFA sum equals targetGFA.
    if (sumGFA <= 0) return;
    const factor = total / sumGFA;
    const next: GfaBreakdown = {};
    for (const c of GFA_CATEGORIES) {
      const m2 = effectiveM2(c.key);
      if (m2 <= 0) continue;
      next[c.key] = { mode: "absolute", value: Number((m2 * factor).toFixed(2)) };
    }
    patch({ gfaBreakdown: next });
  }

  return (
    <div className="card">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="section-title">GFA breakdown</h2>
          <p className="section-sub">
            Split the Target GFA across uses. Each row can be entered either as an absolute
            value in m² or as a percentage of the total — the other one is computed.
          </p>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-ink-500">
              Reference Target GFA:{" "}
              <strong className="text-ink-900 tabular-nums">
                {total.toLocaleString("en-US")} m² · {fmtSqft(total)}
              </strong>
            </div>
            {gfaMismatchPct > 0.005 && sumGFA > 0 && (
              <button
                onClick={rebalanceTo100}
                className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
                title="Scale every row proportionally so the sum equals Target GFA"
              >
                Rebalance to 100%
              </button>
            )}
          </div>
        )}
      </div>

      {total <= 0 && (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-[12.5px] mb-4 leading-snug">
          Set a <strong>Target GFA</strong> above to enable the percentage input mode.
          You can still enter absolute m² per use without it.
        </div>
      )}

      <div className="border border-ink-200">
        <div className="grid grid-cols-[1fr_120px_90px_110px_110px_120px_80px] gap-1 px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
          <div>Use</div>
          <div className="text-right">Input</div>
          <div className="text-center">Mode</div>
          <div className="text-right">BUA m²</div>
          <div className="text-right">GFA m²</div>
          <div className="text-right">≈ sqft (BUA)</div>
          <div className="text-right">% of GFA</div>
        </div>
        {GFA_CATEGORIES.map((c) => {
          const item = getItem(c.key);
          const m2 = effectiveM2(c.key);
          const pct = effectivePct(c.key);
          return (
            <div key={c.key}>
              <div
                className="grid grid-cols-[1fr_120px_90px_110px_110px_120px_80px] gap-1 px-3 py-1.5 items-center text-[12px] tabular-nums border-b border-ink-100"
              >
                <div>
                  <div className="text-ink-900">{c.label}</div>
                  <div className="text-[10.5px] text-ink-500 leading-snug">{c.hint}</div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step={item.mode === "absolute" ? 10 : 0.5}
                    min={0}
                    className="cell-input text-right pr-7"
                    value={item.value || 0}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      setItem(c.key, { value: Number.isFinite(n) && n >= 0 ? n : 0 });
                    }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-ink-400 pointer-events-none">
                    {item.mode === "absolute" ? "m²" : "%"}
                  </span>
                </div>
                <div className="text-center">
                  <button
                    onClick={() => toggleMode(c.key)}
                    disabled={total <= 0 && item.mode === "absolute"}
                    title={total <= 0 ? "Set Target GFA to enable percent mode" : "Switch input mode"}
                    className="px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] border border-ink-300 text-ink-700 hover:bg-bone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    → {item.mode === "absolute" ? "%" : "m²"}
                  </button>
                </div>
                {(() => {
                  const bua = buaFor(c.key);
                  const gfa = gfaFor(c.key);
                  const gfaPct = total > 0 ? (gfa / total) * 100 : 0;
                  return (
                    <>
                      <div className="text-right text-ink-900">{bua > 0 ? Math.round(bua).toLocaleString("en-US") : "—"}</div>
                      <div className="text-right text-qube-800 font-medium">{gfa > 0 ? Math.round(gfa).toLocaleString("en-US") : "—"}</div>
                      <div className="text-right text-ink-500">{fmtSqft(bua)}</div>
                      <div className="text-right text-ink-700">{gfaPct > 0 ? `${gfaPct.toFixed(1)}%` : "—"}</div>
                    </>
                  );
                })()}
              </div>
              {c.key === "residential" && m2 > 0 && (
                <ResidentialSubBreakdown
                  project={project}
                  breakdown={project.residentialBreakdown ?? DEFAULT_RESIDENTIAL_BREAKDOWN}
                  onChange={(next) => patch({ residentialBreakdown: next })}
                />
              )}
            </div>
          );
        })}
        <div className="grid grid-cols-[1fr_120px_90px_110px_110px_120px_80px] gap-1 px-3 py-2 items-center text-[12px] tabular-nums bg-qube-50 font-medium">
          <div className="uppercase tracking-[0.08em] text-[10.5px] text-qube-800">Total of uses</div>
          <div></div>
          <div></div>
          <div className="text-right text-qube-800">{Math.round(sumBUA).toLocaleString("en-US")}</div>
          <div className="text-right text-qube-800">{Math.round(sumGFA).toLocaleString("en-US")}</div>
          <div className="text-right text-qube-700">{fmtSqft(sumBUA)}</div>
          <div className="text-right text-qube-800">{total > 0 ? `${sumPctGFA.toFixed(1)}%` : "—"}</div>
        </div>
      </div>

      {total > 0 && gfaMismatchPct > 0.005 && sumGFA > 0 && (
        <p className="text-[11.5px] mt-3 leading-snug text-amber-900">
          Σ GFA across uses = <strong>{Math.round(sumGFA).toLocaleString("en-US")} m²</strong>{" "}
          ({sumPctGFA.toFixed(1)}%) but Target GFA is{" "}
          <strong>{total.toLocaleString("en-US")} m²</strong>. Adjust the rows or click
          <em> Rebalance to 100%</em> above. Σ BUA = {Math.round(sumBUA).toLocaleString("en-US")} m²
          (BUA &gt; GFA because some sub-categories are flagged Non-GFA).
        </p>
      )}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-2">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-[10.5px] text-ink-500 tabular-nums">{hint}</span>}
    </label>
  );
}

function NumInput({ value, onChange, step = 1, suffix }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  const [text, setText] = useState<string>(Number.isFinite(value) ? String(value) : "0");
  // Sync external value into internal text when it changes from outside
  useEffect(() => {
    const parsed = parseFloat(text);
    if (Number.isFinite(value) && (!Number.isFinite(parsed) || parsed !== value)) {
      setText(String(value));
    }
  }, [value]);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        className="cell-input pr-9"
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          // Allow empty string or a lone '-' / '.' as intermediate typing states.
          if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
          const n = parseFloat(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          const n = parseFloat(text);
          if (!Number.isFinite(n)) {
            setText(String(value));
          } else {
            // Re-normalise the displayed text to the parsed number
            setText(String(n));
            onChange(n);
          }
        }}
        step={step}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">{suffix}</span>}
    </div>
  );
}

const RESIDENTIAL_SUB_CATEGORIES: { key: ResidentialSubCategory; label: string; hint: string }[] = [
  { key: "apartments",  label: "Apartments",  hint: "Net residential — the units themselves." },
  { key: "amenities",   label: "Amenities",   hint: "Indoor gym, lobby, club room, etc." },
  { key: "circulation", label: "Circulation", hint: "Lobbies, corridors, lift cores, stairs." },
  { key: "services",    label: "Services",    hint: "MEP, shafts, ducts, plant rooms." },
];

function ResidentialSubBreakdown({
  project,
  breakdown,
  onChange,
}: {
  project: ReturnType<typeof useProject>;
  breakdown: ResidentialBreakdown;
  onChange: (b: ResidentialBreakdown) => void;
}) {
  function setSub(key: ResidentialSubCategory, partial: Partial<ResidentialBreakdown[ResidentialSubCategory]>) {
    onChange({ ...breakdown, [key]: { ...breakdown[key], ...partial } });
  }
  function balance() {
    // Lock everything except Apartments — set Apartments = 100 − sum(others).
    const others = (["amenities", "circulation", "services"] as ResidentialSubCategory[])
      .reduce((s, k) => s + (breakdown[k]?.pct ?? 0), 0);
    onChange({ ...breakdown, apartments: { ...breakdown.apartments, pct: Math.max(0, 100 - others) } });
  }
  const sumPct = RESIDENTIAL_SUB_CATEGORIES.reduce((s, c) => s + (breakdown[c.key]?.pct ?? 0), 0);
  const gfaSubsM2 = RESIDENTIAL_SUB_CATEGORIES
    .filter((c) => breakdown[c.key]?.countsAsGFA)
    .reduce((s, c) => s + residentialSubGFA(project, c.key), 0);
  const mismatch = Math.abs(sumPct - 100) > 0.5;

  return (
    <div className="bg-bone-50 border-b border-ink-100 px-3 py-2 grid gap-1">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="eyebrow text-ink-500 text-[10px]">Residential composition</div>
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] text-ink-500">
            GFA-counted residential: <strong className="text-ink-900 tabular-nums">{Math.round(gfaSubsM2).toLocaleString("en-US")} m²</strong>
          </span>
          {mismatch && (
            <button
              onClick={balance}
              className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
              title="Set Apartments = 100% − (amenities + circulation + services)"
            >Balance to 100%</button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[14px_1fr_80px_90px_110px_110px_110px] gap-1 px-1 py-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 border-b border-ink-200">
        <span></span>
        <span>Subcategory</span>
        <span className="text-right">% of res.</span>
        <span className="text-center">Counts as GFA</span>
        <span className="text-right">BUA m²</span>
        <span className="text-right">GFA m²</span>
        <span className="text-right">≈ sqft (BUA)</span>
      </div>
      {RESIDENTIAL_SUB_CATEGORIES.map((c) => {
        const sub = breakdown[c.key];
        const subBUA = residentialSubBUA(project, c.key);
        const subGFA = residentialSubGFA(project, c.key);
        return (
          <div
            key={c.key}
            className="grid grid-cols-[14px_1fr_80px_90px_110px_110px_110px] gap-1 px-1 py-1 items-center text-[12px] tabular-nums"
          >
            <span className="text-ink-300 text-[14px] leading-none">└</span>
            <div>
              <div className="text-ink-900">{c.label}</div>
              <div className="text-[10px] text-ink-500 leading-snug">{c.hint}</div>
            </div>
            <div className="relative">
              <input
                type="number"
                step={0.5}
                min={0}
                max={100}
                className="cell-input text-right pr-6 !py-1 !px-1.5"
                value={Number((sub.pct ?? 0).toFixed(1))}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n >= 0) setSub(c.key, { pct: n });
                }}
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9.5px] text-ink-400 pointer-events-none">%</span>
            </div>
            <div className="text-center">
              <button
                onClick={() => setSub(c.key, { countsAsGFA: !sub.countsAsGFA })}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] border ${
                  sub.countsAsGFA
                    ? "bg-qube-500 text-white border-qube-500"
                    : "bg-white text-ink-500 border-ink-300"
                }`}
              >{sub.countsAsGFA ? "GFA" : "Non-GFA"}</button>
            </div>
            <div className="text-right text-ink-900">{subBUA > 0 ? Math.round(subBUA).toLocaleString("en-US") : "—"}</div>
            <div className="text-right text-qube-800 font-medium">{subGFA > 0 ? Math.round(subGFA).toLocaleString("en-US") : "—"}</div>
            <div className="text-right text-ink-500">{subBUA > 0 ? `${Math.round(subBUA * M2_TO_SQFT).toLocaleString("en-US")} sqft` : "—"}</div>
          </div>
        );
      })}
      <div className="grid grid-cols-[14px_1fr_80px_90px_110px_110px_110px] gap-1 px-1 py-1 items-center text-[11px] tabular-nums">
        <span></span>
        <span className="uppercase tracking-[0.08em] text-[10.5px] text-ink-500">Sum</span>
        <span className={`text-right ${mismatch ? "text-amber-700 font-medium" : "text-ink-700"}`}>{sumPct.toFixed(1)}%</span>
        <span></span>
        <span className="text-right text-ink-700">{Math.round(RESIDENTIAL_SUB_CATEGORIES.reduce((s, c) => s + residentialSubBUA(project, c.key), 0)).toLocaleString("en-US")}</span>
        <span className="text-right text-qube-800">{Math.round(gfaSubsM2).toLocaleString("en-US")}</span>
        <span></span>
      </div>
    </div>
  );
}
