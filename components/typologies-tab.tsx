"use client";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import type { Typology, UnitCategory } from "@/lib/types";
import { useZoneLibrary } from "@/lib/use-zone-library";
import {
  classForZone,
  TYPOLOGY_LABELS,
  type TypologyKey,
  type ZoneClass,
} from "@/lib/zone-classes";

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

  function update(t: Typology, patch: Partial<Typology>) {
    upsert({ ...t, ...patch });
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

  /** Edit balcony % directly. We keep the typology's INTERIOR constant and
   *  scale the balcony so that pct = balcony / (interior + balcony). Total
   *  area (= interior + balcony) and the sellable shown in the Program tab
   *  therefore grow when the balcony % grows — that's how a bigger balcony
   *  affects the unit's overall sellable size. */
  function setBalconyPct(t: Typology, pctValue: number) {
    if (!Number.isFinite(pctValue) || pctValue < 0) pctValue = 0;
    if (pctValue > 99.9) pctValue = 99.9;
    const interior = t.internalArea;
    const balcony = pctValue > 0 ? (interior * pctValue) / (100 - pctValue) : 0;
    upsert({ ...t, internalArea: interior, balconyArea: Number(balcony.toFixed(2)) });
  }

  /**
   * Create one typology per non-zero category in the detected class.
   * Areas come from the class's average sellable (mid-range, SqFt → m²),
   * split between interior and balcony using `balconyPctOfNsa`. Iteration
   * order follows TYPOLOGY_KEYS so Studio is first.
   */
  function applyClassMix(letter: ZoneClass) {
    const row = library[letter];
    const balconyShare = row.balconyPctOfNsa;
    const created: Typology[] = [];
    for (const key of (Object.keys(row.typologyMix) as TypologyKey[])) {
      const pct = row.typologyMix[key];
      if (pct < 0.005) continue;
      const cat = CATEGORY_FOR_TYPOLOGY_KEY[key];
      if (!cat) continue;
      const [lo, hi] = row.avgAreaSqft[key];
      const avgSqft = hi > 0 ? (lo + hi) / 2 : lo;
      const totalM2 = avgSqft / SQFT_PER_M2;
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
      alert("This class has no positive mix entries to apply.");
      return;
    }
    if (project.typologies.length > 0) {
      const ok = confirm(
        `Replace the existing ${project.typologies.length} typology(ies) with ${created.length} new ones from class ${letter}? The Program matrix will be cleared.`,
      );
      if (!ok) return;
      for (const t of [...project.typologies]) remove(t.id);
    }
    for (const t of created) upsert(t);
  }

  return (
    <div className="grid gap-6">
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
                    <th className="text-right py-1 font-medium">Avg area (min–max)</th>
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
                <strong> average</strong> sellable area. Below, edit <em>Total area</em>
                and the balcony is auto-deducted at{" "}
                <strong>{(library[detectedClass].balconyPctOfNsa * 100).toFixed(1)}%</strong>{" "}
                of total (class {detectedClass} from the matrix).
              </p>
            </div>
          </div>
        </div>
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
