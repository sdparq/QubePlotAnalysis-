"use client";
import { useEffect, useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import type { Typology, UnitCategory } from "@/lib/types";
import { useZoneLibrary } from "@/lib/use-zone-library";
import {
  classForZone,
  TYPOLOGY_LABELS,
  type TypologyKey,
  type ZoneClass,
} from "@/lib/zone-classes";
import {
  computeProgramAutoFill,
  effectiveMixPctForCategory,
  resolveTypologyMix,
} from "@/lib/calc/program-autofill";

const CATEGORIES: UnitCategory[] = ["Studio", "1BR", "2BR", "3BR", "4BR", "Penthouse"];

const DEFAULT_PARKING: Record<UnitCategory, number> = {
  Studio: 1, "1BR": 1, "2BR": 1, "3BR": 2, "4BR": 2, Penthouse: 2,
};
// Default occupancy (persons / unit) per Dubai DCD residential standard, Table D.5.
// +1 person for each additional bedroom or live-in housekeeper room.
const DEFAULT_OCCUPANCY: Record<UnitCategory, number> = {
  Studio: 1.5, "1BR": 1.8, "2BR": 3, "3BR": 4, "4BR": 5, Penthouse: 6,
};

const SQFT_PER_M2 = 10.7639;

// Map class-library keys to the project's existing UnitCategory enum.
const CATEGORY_FOR_TYPOLOGY_KEY: Record<TypologyKey, UnitCategory | null> = {
  studio: "Studio",
  "1BR": "1BR",
  "2BR": "2BR",
  "3BR": "3BR",
  "4BR": "4BR",
  "5BR": null,    // not modelled today
  "6BR": null,
  "7BR": null,
  penthouse: "Penthouse",
};

export default function TypologiesTab() {
  const project = useProject();
  const upsert = useStore((s) => s.upsertTypology);
  const remove = useStore((s) => s.removeTypology);
  const patch = useStore((s) => s.patch);
  const { library } = useZoneLibrary();

  const detectedClass: ZoneClass | null = useMemo(
    () => classForZone(project.zone, library),
    [project.zone, library],
  );

  function addNew() {
    upsert({
      id: `t-${Date.now()}`,
      name: "New Typology",
      category: "Studio",
      internalArea: 0,
      balconyArea: 0,
      occupancy: DEFAULT_OCCUPANCY.Studio,
      parkingPerUnit: DEFAULT_PARKING.Studio,
    });
  }

  function update(t: Typology, partial: Partial<Typology>) {
    upsert({ ...t, ...partial });
  }

  /** Persist a new project-level mix override and silently re-run the
   *  Apartments auto-fill so the next tab reflects the change immediately. */
  function patchAndRefill(nextMix: Partial<Record<UnitCategory, number>> | undefined) {
    const projAfter = { ...project, typologyMix: nextMix };
    const classMix = detectedClass ? library[detectedClass].typologyMix : null;
    if (classMix) {
      const resolved = resolveTypologyMix(projAfter, classMix);
      const fill = computeProgramAutoFill(projAfter, resolved);
      patch({ typologyMix: nextMix, program: fill?.cells ?? project.program });
    } else {
      patch({ typologyMix: nextMix });
    }
  }

  function setMixForCategory(cat: UnitCategory, pct: number) {
    const safe = Math.max(0, Math.min(100, pct));
    patchAndRefill({ ...(project.typologyMix ?? {}), [cat]: safe });
  }

  function resetMixForCategory(cat: UnitCategory) {
    const next = { ...(project.typologyMix ?? {}) };
    delete next[cat];
    patchAndRefill(Object.keys(next).length === 0 ? undefined : next);
  }

  function resetAllMix() {
    patchAndRefill(undefined);
  }

  function normalizeMix() {
    const classMix = detectedClass ? library[detectedClass].typologyMix : null;
    if (!classMix) return;
    const eff = CATEGORIES.map((c) => ({
      cat: c,
      pct: effectiveMixPctForCategory(project, classMix, c),
    }));
    const sum = eff.reduce((s, e) => s + e.pct, 0);
    if (sum <= 0) return;
    const factor = 100 / sum;
    const next: Partial<Record<UnitCategory, number>> = {};
    for (const e of eff) {
      if (e.pct > 0) next[e.cat] = Number((e.pct * factor).toFixed(1));
    }
    patchAndRefill(next);
  }

  /**
   * The user enters the TOTAL sellable area (interior + balcony). We keep the
   * typology's CURRENT balcony fraction stable: editing Total scales balcony
   * and interior proportionally. If the typology hasn't been set up yet (its
   * current balcony fraction is 0 AND interior is 0), we seed the balcony
   * fraction from the detected class — otherwise leave it as 0%.
   */
  function setTotal(t: Typology, totalM2: number) {
    if (!Number.isFinite(totalM2) || totalM2 < 0) totalM2 = 0;
    const oldTotal = t.internalArea + t.balconyArea;
    let pct: number;
    if (oldTotal > 0) {
      pct = t.balconyArea / oldTotal;
    } else if (detectedClass) {
      pct = library[detectedClass].balconyPctOfNsa;
    } else {
      pct = 0;
    }
    const balcony = Number((totalM2 * pct).toFixed(2));
    const interior = Number((totalM2 - balcony).toFixed(2));
    upsert({ ...t, internalArea: interior, balconyArea: balcony });
  }

  /** Edit balcony % directly. We keep the Total area constant (= average of
   *  min/max for the class) and redistribute between interior and balcony.
   *  The Program tab reflects this through `Interior GFA` (= interior × units
   *  per floor) — Sellable stays fixed because Total is the sum of the two. */
  function setBalconyPct(t: Typology, pctValue: number) {
    if (!Number.isFinite(pctValue) || pctValue < 0) pctValue = 0;
    if (pctValue > 100) pctValue = 100;
    const total = t.internalArea + t.balconyArea;
    const balcony = Number(((total * pctValue) / 100).toFixed(2));
    const interior = Number((total - balcony).toFixed(2));
    upsert({ ...t, internalArea: interior, balconyArea: balcony });
  }

  /**
   * Create one typology per non-zero category in the detected class.
   * Areas come from the class's minimum sellable (low end of the range,
   * SqFt → m²), split between interior and balcony using `balconyPctOfNsa`.
   * Iteration order follows TYPOLOGY_KEYS so Studio is first.
   */
  function applyClassMix(letter: ZoneClass, opts?: { silent?: boolean }) {
    const row = library[letter];
    const balconyShare = row.balconyPctOfNsa;
    const created: Typology[] = [];
    for (const key of (Object.keys(row.typologyMix) as TypologyKey[])) {
      const pct = row.typologyMix[key];
      if (pct < 0.005) continue;
      const cat = CATEGORY_FOR_TYPOLOGY_KEY[key];
      if (!cat) continue;
      const [lo] = row.avgAreaSqft[key];
      const totalM2 = lo / SQFT_PER_M2;
      if (totalM2 <= 0) continue;
      const balconyM2 = totalM2 * balconyShare;
      const interiorM2 = totalM2 - balconyM2;
      created.push({
        id: `t-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: `${TYPOLOGY_LABELS[key]} · class ${letter}`,
        category: cat,
        internalArea: Number(interiorM2.toFixed(1)),
        balconyArea: Number(balconyM2.toFixed(1)),
        occupancy: DEFAULT_OCCUPANCY[cat],
        parkingPerUnit: DEFAULT_PARKING[cat],
      });
    }
    if (created.length === 0) {
      // Mark as seeded even when nothing was created — otherwise the auto-seed
      // effect retries (and alerts) on every mount of this tab.
      if (!project.typologiesSeeded) patch({ typologiesSeeded: true });
      if (!opts?.silent) alert("This class has no positive mix entries to apply.");
      return;
    }
    if (project.typologies.length > 0) {
      const ok = confirm(
        `Replace the existing ${project.typologies.length} typology(ies) with ${created.length} new ones from class ${letter}? The Program matrix will be refilled.`,
      );
      if (!ok) return;
      for (const t of [...project.typologies]) remove(t.id);
    }
    for (const t of created) upsert(t);
    if (!project.typologiesSeeded) patch({ typologiesSeeded: true });

    // Immediately auto-fill the Apartments matrix from the new typology list —
    // otherwise Program (and everything downstream: Parking, Lifts, Areas
    // Summary) stays empty until the user separately visits Program and clicks
    // "Apply to N floors" there, which reads as "typologies aren't applying".
    const projAfter = { ...project, typologies: created };
    const resolvedMix = resolveTypologyMix(projAfter, row.typologyMix);
    const fill = computeProgramAutoFill(projAfter, resolvedMix);
    patch({ program: fill?.cells ?? [] });
  }

  // Auto-seed the typology list the first time a project lands on this tab with
  // a recognised zone class and no typologies yet. Sets `typologiesSeeded` so
  // we never re-fill silently — if the user deletes everything they stay empty.
  useEffect(() => {
    if (project.typologiesSeeded) return;
    if (project.typologies.length > 0) {
      patch({ typologiesSeeded: true });
      return;
    }
    if (!detectedClass) return;
    applyClassMix(detectedClass, { silent: true });
    // applyClassMix already patches `typologiesSeeded: true` when the list was empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.typologiesSeeded, project.typologies.length, detectedClass]);

  return (
    <div className="grid gap-6">
      {!detectedClass && (
        <div className="card bg-amber-50 border-amber-200">
          <div className="eyebrow text-amber-800 text-[10px]">No class detected for this zone</div>
          <p className="text-[12.5px] text-ink-800 mt-1 leading-snug">
            Current zone: <strong>{project.zone ? `"${project.zone}"` : "(empty)"}</strong>. It doesn&apos;t match
            any location in the Class Library, so there is no suggested mix and no{" "}
            <strong>Apply class mix</strong> button here. Either:
          </p>
          <ul className="text-[12.5px] text-ink-800 mt-1.5 leading-snug list-disc pl-5 space-y-0.5">
            <li>Pick a listed zone in <strong>Setup</strong> (tab 01, &quot;Dubai zone&quot;), or</li>
            <li>Open <strong>Class Library</strong> (tab L) and add this exact zone name to whichever class fits it.</li>
          </ul>
          <p className="text-[11px] text-ink-600 mt-2 leading-snug">
            You can still add typologies manually below without a detected class.
          </p>
        </div>
      )}

      {detectedClass && (
        <div className="card bg-qube-50 border-qube-200">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="text-[36px] font-light text-qube-700 tabular-nums leading-none">{detectedClass}</div>
            <div className="flex-1 min-w-[260px]">
              <div className="eyebrow text-qube-800 text-[10px]">Suggested mix for this zone</div>
              <div className="text-[14px] font-medium text-ink-900 mt-0.5">{library[detectedClass].name}</div>
              <table className="w-full mt-3 text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-[0.08em] text-ink-500">
                    <th className="text-left py-1 font-medium">Typology</th>
                    <th className="text-right py-1 font-medium">% of units</th>
                    <th className="text-right py-1 font-medium">Min area (min–max)</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(library[detectedClass].typologyMix) as TypologyKey[])
                    .filter((k) => library[detectedClass].typologyMix[k] > 0.001)
                    .map((k) => {
                      const pct = library[detectedClass].typologyMix[k];
                      const [lo, hi] = library[detectedClass].avgAreaSqft[k];
                      return (
                        <tr key={k} className="border-t border-qube-200/60">
                          <td className="py-1 text-ink-900">{TYPOLOGY_LABELS[k]}</td>
                          <td className="text-right text-ink-900">{(pct * 100).toFixed(1)}%</td>
                          <td className="text-right text-ink-600">
                            {lo === hi ? `${lo.toLocaleString("en-US")}` : `${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")}`} sqft
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2 min-w-[180px]">
              <button
                className="btn btn-primary"
                onClick={() => applyClassMix(detectedClass)}
              >Apply class {detectedClass} mix</button>
              <p className="text-[10.5px] text-ink-500 leading-snug">
                Creates one typology per non-zero category using the class&apos;s
                <strong> minimum</strong> sellable area. Below, edit <em>Total area</em>
                and the balcony is auto-deducted at{" "}
                <strong>{(library[detectedClass].balconyPctOfNsa * 100).toFixed(1)}%</strong>{" "}
                of total (class {detectedClass} from the matrix).
              </p>
            </div>
          </div>
        </div>
      )}

      {detectedClass && (
        <UnitMixCard
          library={library}
          detectedClass={detectedClass}
          project={project}
          onSetCategory={setMixForCategory}
          onResetCategory={resetMixForCategory}
          onResetAll={resetAllMix}
          onNormalize={normalizeMix}
        />
      )}

      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="section-title">Typologies</h2>
            <p className="section-sub">Define each unit type used in the project. Areas in m². Occupancy and parking ratios drive the lift and parking calculations.</p>
          </div>
          <button className="btn btn-primary" onClick={addNew}>+ Add typology</button>
        </div>
        {project.typologies.length === 0 ? (
          <div className="text-sm text-ink-500 italic py-10 text-center">No typologies yet — add one to start.</div>
        ) : (
          <div>
            <table className="tbl w-full table-fixed">
              <colgroup>
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th className="text-right">Total area (m²)</th>
                  <th className="text-right">Balcony %{detectedClass && ` · class ${(library[detectedClass].balconyPctOfNsa * 100).toFixed(0)}%`}</th>
                  <th className="text-right">Occupancy</th>
                  <th className="text-right">Parking / unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {project.typologies.map((t) => {
                  const total = t.internalArea + t.balconyArea;
                  return (
                  <tr key={t.id}>
                    <td className="cell-edit">
                      <input className="cell-input" value={t.name} onChange={(e) => update(t, { name: e.target.value })} />
                    </td>
                    <td className="cell-edit">
                      <select
                        className="cell-input"
                        value={t.category}
                        onChange={(e) => {
                          const cat = e.target.value as UnitCategory;
                          update(t, { category: cat, occupancy: DEFAULT_OCCUPANCY[cat], parkingPerUnit: DEFAULT_PARKING[cat] });
                        }}
                      >
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="cell-edit">
                      <input
                        type="number"
                        step={0.5}
                        min={0}
                        className="cell-input text-right"
                        value={Number(total.toFixed(2))}
                        onChange={(e) => setTotal(t, parseFloat(e.target.value) || 0)}
                        title="Total sellable (interior + balcony). Editing this auto-deducts balcony from the class %."
                      />
                    </td>
                    <td className="cell-edit">
                      <div className="relative">
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          max={100}
                          className="cell-input text-right pr-7"
                          value={total > 0 ? Number(((t.balconyArea / total) * 100).toFixed(1)) : 0}
                          onChange={(e) => setBalconyPct(t, parseFloat(e.target.value) || 0)}
                          title="Balcony as % of Total area. Editing this keeps Total constant."
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-ink-400 pointer-events-none">%</span>
                      </div>
                      <div className="text-[10px] text-ink-500 text-right mt-0.5 tabular-nums">
                        = {t.balconyArea.toFixed(1)} m²
                      </div>
                    </td>
                    <td className="cell-edit">
                      <input type="number" step={0.1} className="cell-input text-right"
                        value={t.occupancy} onChange={(e) => update(t, { occupancy: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="cell-edit">
                      <input type="number" step={0.1} className="cell-input text-right"
                        value={t.parkingPerUnit} onChange={(e) => update(t, { parkingPerUnit: parseFloat(e.target.value) || 0 })} />
                    </td>
                    <td className="text-right">
                      <button className="btn btn-danger btn-xs" onClick={() => { if (confirm(`Delete ${t.name}?`)) remove(t.id); }}>Delete</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function UnitMixCard({
  library,
  detectedClass,
  project,
  onSetCategory,
  onResetCategory,
  onResetAll,
  onNormalize,
}: {
  library: ReturnType<typeof useZoneLibrary>["library"];
  detectedClass: ZoneClass;
  project: ReturnType<typeof useProject>;
  onSetCategory: (cat: UnitCategory, pct: number) => void;
  onResetCategory: (cat: UnitCategory) => void;
  onResetAll: () => void;
  onNormalize: () => void;
}) {
  const classMix = library[detectedClass].typologyMix;
  const override = project.typologyMix ?? {};
  const hasAnyOverride = Object.keys(override).length > 0;

  const rows = CATEGORIES.map((cat) => {
    const classPct = effectiveMixPctForCategory(
      { ...project, typologyMix: undefined } as ReturnType<typeof useProject>,
      classMix,
      cat,
    );
    const effPct = effectiveMixPctForCategory(project, classMix, cat);
    const isOverride = override[cat] !== undefined;
    return { cat, classPct, effPct, isOverride };
  });
  const effSum = rows.reduce((s, r) => s + r.effPct, 0);
  const offNorm = Math.abs(effSum - 100) > 0.5;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="section-title">Unit mix · this project</h2>
          <p className="section-sub">
            Override per-category {`% of total units`} just for this project. Editing any row
            re-runs the Apartments auto-fill silently. Italic numbers are the class {detectedClass}{" "}
            default; bold numbers are project overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAnyOverride && (
            <button
              className="text-[11px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
              onClick={onResetAll}
              title="Clear every override and fall back to class defaults"
            >Reset to class {detectedClass}</button>
          )}
          {offNorm && (
            <button
              className="text-[11px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900 underline"
              onClick={onNormalize}
              title="Scale every category proportionally so the sum equals 100%"
            >Normalize to 100%</button>
          )}
        </div>
      </div>

      <div className="border border-ink-200">
        <div className="grid grid-cols-[1fr_110px_110px_70px] gap-1 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
          <div>Category</div>
          <div className="text-right">Class {detectedClass} default</div>
          <div className="text-right">This project %</div>
          <div></div>
        </div>
        {rows.map((r) => (
          <div
            key={r.cat}
            className="grid grid-cols-[1fr_110px_110px_70px] gap-1 px-3 py-1.5 items-center text-[12px] tabular-nums border-b border-ink-100 last:border-b-0"
          >
            <div className="text-ink-900">{r.cat}</div>
            <div className="text-right text-ink-500">{r.classPct.toFixed(1)}%</div>
            <div className="text-right">
              <div className="relative inline-block">
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  max={100}
                  className={`cell-input text-right pr-6 !py-1 !px-1.5 w-[90px] ${
                    r.isOverride ? "text-ink-900 font-medium" : "text-ink-500 italic"
                  }`}
                  value={Number(r.effPct.toFixed(1))}
                  onChange={(e) => onSetCategory(r.cat, parseFloat(e.target.value) || 0)}
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9.5px] text-ink-400 pointer-events-none">%</span>
              </div>
            </div>
            <div className="text-right">
              {r.isOverride ? (
                <button
                  onClick={() => onResetCategory(r.cat)}
                  className="text-[10px] uppercase tracking-[0.10em] text-ink-500 hover:text-qube-700"
                  title="Revert this category to the class default"
                >Reset</button>
              ) : (
                <span className="text-[10px] text-ink-300">default</span>
              )}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_110px_110px_70px] gap-1 px-3 py-1.5 items-center text-[11.5px] tabular-nums bg-bone-50/40 border-t border-ink-200">
          <div className="uppercase tracking-[0.08em] text-[10.5px] text-ink-500">Sum</div>
          <div className="text-right text-ink-500">100.0%</div>
          <div className={`text-right ${offNorm ? "text-amber-700 font-medium" : "text-ink-700"}`}>
            {effSum.toFixed(1)}%
          </div>
          <div></div>
        </div>
      </div>

      <p className="text-[11px] text-ink-500 mt-3 leading-snug">
        The mix drives the Apartments auto-fill: total units N = Apartments GFA / average interior area
        weighted by these %s, then units<sub>cat</sub> = round(N × %<sub>cat</sub> / 100). Categories
        with no typology in this project contribute zero — add a typology of that category above if you
        want it to count.
      </p>
    </div>
  );
}
