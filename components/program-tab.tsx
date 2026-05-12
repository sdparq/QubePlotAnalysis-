"use client";
import { useMemo, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmt2 } from "@/lib/format";
import { useZoneLibrary } from "@/lib/use-zone-library";
import { classForZone, TYPOLOGY_KEYS, type TypologyKey } from "@/lib/zone-classes";
import type { UnitCategory } from "@/lib/types";

const CATEGORY_FOR_TYPOLOGY_KEY: Record<TypologyKey, UnitCategory | null> = {
  studio: "Studio",
  "1BR": "1BR",
  "2BR": "2BR",
  "3BR": "3BR",
  "4BR": "4BR",
  "5BR": null,
  "6BR": null,
  "7BR": null,
  penthouse: "Penthouse",
};

/** Distribute `total` across `n` slots according to integer rounding with the
 *  largest-remainder rule, so the slots sum to exactly `round(total)`. */
function distributeIntegers(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sumW) * total);
  const floors = raw.map((v) => Math.floor(v));
  let remainder = Math.round(total) - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

export default function ProgramTab() {
  const project = useProject();
  const setCell = useStore((s) => s.setProgramCell);
  const program = computeProgram(project);
  const { library } = useZoneLibrary();
  const detectedClass = useMemo(() => classForZone(project.zone, library), [project.zone, library]);

  const cellValue = (floor: number, typologyId: string) =>
    project.program.find((c) => c.floor === floor && c.typologyId === typologyId)?.count ?? 0;

  const shortName = (n: string) =>
    n
      .replace(/\bType\s+/i, "")
      .replace(/\bStudio\b/i, "Std")
      .replace(/\bPenthouse\b/i, "PH")
      .replace(/\s+/g, " ")
      .trim();

  if (project.typologies.length === 0) {
    return (
      <div className="card text-center text-ink-500 italic py-10">
        Add typologies first (tab 02) to start filling the program.
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {detectedClass && (
        <AutoFillPanel
          letter={detectedClass}
          mix={library[detectedClass].typologyMix}
          numFloors={project.numFloors}
          typologies={project.typologies}
          existingProgramCount={project.program.length}
          onApply={(cellsByFloor) => {
            // Clear every existing cell, then write the new ones.
            for (const c of [...project.program]) {
              setCell(c.floor, c.typologyId, 0);
            }
            for (const [floorStr, cells] of Object.entries(cellsByFloor)) {
              const floor = parseInt(floorStr, 10);
              for (const { typologyId, count } of cells) {
                if (count > 0) setCell(floor, typologyId, count);
              }
            }
          }}
        />
      )}

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Program — units per floor</h2>
          <p className="section-sub">Set the count of each typology on each floor. Subtotals update live.</p>
        </div>
        <div className="w-full">
          <table className="tbl table-fixed w-full">
            <colgroup>
              <col style={{ width: 90 }} />
              {project.typologies.map((t) => <col key={t.id} />)}
              <col style={{ width: 70 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="!py-3">Floor</th>
                {project.typologies.map((t) => (
                  <th key={t.id} className="text-right !px-1 align-bottom" title={t.name}>
                    <span className="block leading-tight whitespace-nowrap">{shortName(t.name)}</span>
                  </th>
                ))}
                <th className="text-right !px-1">Units</th>
                <th className="text-right">Sellable</th>
                <th className="text-right">Interior GFA</th>
              </tr>
            </thead>
            <tbody>
              {program.byFloor.map((f) => (
                <tr key={f.floor}>
                  <td className="font-medium text-ink-900">Floor {f.floor}</td>
                  {project.typologies.map((t) => (
                    <td key={t.id} className="!p-1">
                      <input
                        type="number"
                        min={0}
                        className="cell-input text-right !px-1.5 !py-1.5 text-sm"
                        value={cellValue(f.floor, t.id)}
                        onChange={(e) => setCell(f.floor, t.id, Math.max(0, Math.round(parseFloat(e.target.value) || 0)))}
                      />
                    </td>
                  ))}
                  <td className="text-right font-medium !px-2">{fmt0(f.units)}</td>
                  <td className="text-right">{fmt2(f.totalSellable)}</td>
                  <td className="text-right">{fmt2(f.totalInteriorGFA)}</td>
                </tr>
              ))}
              <tr className="row-total">
                <td>TOTAL</td>
                {project.typologies.map((t) => {
                  const ts = program.byTypology.find((x) => x.typology.id === t.id);
                  return <td key={t.id} className="text-right !px-2">{fmt0(ts?.totalUnits ?? 0)}</td>;
                })}
                <td className="text-right !px-2">{fmt0(program.totalUnits)}</td>
                <td className="text-right">{fmt2(program.totalSellable)}</td>
                <td className="text-right">{fmt2(program.totalInteriorGFA)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Mix by typology</h2>
        </div>
        <table className="tbl w-full">
          <colgroup>
            <col />
            <col style={{ width: 100 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Typology</th>
              <th className="text-right">Units</th>
              <th className="text-right">% of total</th>
              <th className="text-right">Total interior (m²)</th>
              <th className="text-right">Total sellable (m²)</th>
            </tr>
          </thead>
          <tbody>
            {program.byTypology.map((ts) => (
              <tr key={ts.typology.id}>
                <td className="font-medium text-ink-900">{ts.typology.name} <span className="text-ink-400 text-xs ml-1">{ts.typology.category}</span></td>
                <td className="text-right">{fmt0(ts.totalUnits)}</td>
                <td className="text-right">{(ts.pctOfTotal * 100).toFixed(1)}%</td>
                <td className="text-right">{fmt2(ts.totalInteriorGFA)}</td>
                <td className="text-right">{fmt2(ts.totalSellable)}</td>
              </tr>
            ))}
            <tr className="row-total">
              <td>TOTAL</td>
              <td className="text-right">{fmt0(program.totalUnits)}</td>
              <td className="text-right">100.0%</td>
              <td className="text-right">{fmt2(program.totalInteriorGFA)}</td>
              <td className="text-right">{fmt2(program.totalSellable)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AutoFillPanelProps {
  letter: ReturnType<typeof classForZone>;
  mix: Record<TypologyKey, number>;
  numFloors: number;
  typologies: { id: string; name: string; category: UnitCategory }[];
  existingProgramCount: number;
  onApply: (cellsByFloor: Record<number, { typologyId: string; count: number }[]>) => void;
}

function AutoFillPanel({ letter, mix, numFloors, typologies, existingProgramCount, onApply }: AutoFillPanelProps) {
  const [unitsPerFloor, setUnitsPerFloor] = useState<number>(10);

  // Categories that have at least one project typology assigned. Without one
  // we can't place its mix share — flag it so the user can spot the drop.
  const categoryHasTypologies = (cat: UnitCategory) => typologies.some((t) => t.category === cat);
  const droppedKeys: TypologyKey[] = [];
  for (const k of TYPOLOGY_KEYS) {
    const cat = CATEGORY_FOR_TYPOLOGY_KEY[k];
    const pct = mix[k];
    if (pct > 0.001 && (!cat || !categoryHasTypologies(cat))) droppedKeys.push(k);
  }
  const droppedShare = droppedKeys.reduce((s, k) => s + mix[k], 0);

  // Preview of per-floor counts per project typology, without applying yet.
  const preview = useMemo(() => {
    // Build a vector of weights aligned with the project typologies. For each
    // project typology, weight = mix[key_for_its_category] / (#typologies in that category).
    const weights = typologies.map((t) => {
      // find the TypologyKey whose category maps back to this one
      const k = TYPOLOGY_KEYS.find((kk) => CATEGORY_FOR_TYPOLOGY_KEY[kk] === t.category);
      if (!k) return 0;
      const sameCat = typologies.filter((x) => x.category === t.category).length;
      return mix[k] / Math.max(1, sameCat);
    });
    return distributeIntegers(unitsPerFloor, weights);
  }, [typologies, mix, unitsPerFloor]);

  function apply() {
    if (existingProgramCount > 0) {
      const ok = confirm(
        "This will replace every existing cell in the Program matrix with the auto-distributed counts. Continue?",
      );
      if (!ok) return;
    }
    const cellsByFloor: Record<number, { typologyId: string; count: number }[]> = {};
    for (let f = 1; f <= numFloors; f++) {
      cellsByFloor[f] = typologies.map((t, i) => ({ typologyId: t.id, count: preview[i] }));
    }
    onApply(cellsByFloor);
  }

  const totalUnits = preview.reduce((a, b) => a + b, 0) * numFloors;

  return (
    <div className="card bg-qube-50 border-qube-200">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="text-[28px] font-light text-qube-700 tabular-nums leading-none">{letter}</div>
        <div className="flex-1 min-w-[260px]">
          <div className="eyebrow text-qube-800 text-[10px]">Auto-fill from class mix</div>
          <p className="text-[12px] text-ink-700 mt-1 leading-snug">
            Distribute units across the matrix using class {letter}&apos;s typology mix.
            Each typical floor gets the same distribution; the same pattern is replicated
            on every floor.
          </p>
          <div className="flex items-end gap-3 mt-3 flex-wrap">
            <label className="grid gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Units per typical floor</span>
              <input
                type="number"
                min={1}
                step={1}
                className="cell-input text-right w-32"
                value={unitsPerFloor}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n) && n >= 0) setUnitsPerFloor(n);
                }}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={apply}
              disabled={typologies.length === 0 || numFloors <= 0 || unitsPerFloor <= 0}
            >Apply to all {numFloors} floor{numFloors === 1 ? "" : "s"}</button>
            <span className="text-[11.5px] text-ink-700">
              ≈ <strong>{totalUnits.toLocaleString("en-US")}</strong> total units
            </span>
          </div>
          {droppedKeys.length > 0 && (
            <p className="text-[11px] text-amber-800 mt-2 leading-snug">
              {(droppedShare * 100).toFixed(1)}% of the class mix has no matching typology in the
              project — those units are dropped (categories: {droppedKeys.join(", ")}).
              Add a typology of that category in the Typologies tab to capture them.
            </p>
          )}
          {typologies.length > 0 && (
            <div className="mt-3">
              <div className="eyebrow text-ink-500 text-[10px]">Per typology, per floor</div>
              <div className="text-[11.5px] text-ink-900 tabular-nums mt-1">
                {typologies.map((t, i) => `${preview[i]}× ${t.name}`).join(" · ")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
