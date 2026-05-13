"use client";
import { useMemo, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmt2 } from "@/lib/format";
import { useZoneLibrary } from "@/lib/use-zone-library";
import { classForZone, TYPOLOGY_KEYS, type TypologyKey } from "@/lib/zone-classes";
import { residentialSubGFA } from "@/lib/calc/gfa";
import {
  type Typology,
  type UnitCategory,
} from "@/lib/types";

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

/** Apartments-only GFA from Setup. Delegates to the shared helper so the math
 *  stays consistent with the Setup table and the Common Areas group totals. */
function computeApartmentsGFA(project: ReturnType<typeof useProject>): number {
  return residentialSubGFA(project, "apartments");
}

export default function ProgramTab() {
  const project = useProject();
  const setCell = useStore((s) => s.setProgramCell);
  const program = computeProgram(project);
  const { library } = useZoneLibrary();
  const detectedClass = useMemo(() => classForZone(project.zone, library), [project.zone, library]);
  const apartmentsGFA = useMemo(() => computeApartmentsGFA(project), [project]);

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
          apartmentsGFA={apartmentsGFA}
          existingProgramCount={project.program.length}
          onApply={(cellsByFloor) => {
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
  typologies: Typology[];
  apartmentsGFA: number;
  existingProgramCount: number;
  onApply: (cellsByFloor: Record<number, { typologyId: string; count: number }[]>) => void;
}

function AutoFillPanel({ letter, mix, numFloors, typologies, apartmentsGFA, existingProgramCount, onApply }: AutoFillPanelProps) {
  // Mix entries whose category has no typology in the project — those units
  // would be dropped. Flag them so the user can add the missing typology.
  const droppedKeys: TypologyKey[] = [];
  for (const k of TYPOLOGY_KEYS) {
    const cat = CATEGORY_FOR_TYPOLOGY_KEY[k];
    const pct = mix[k];
    if (pct > 0.001 && (!cat || !typologies.some((t) => t.category === cat))) droppedKeys.push(k);
  }
  const droppedShare = droppedKeys.reduce((s, k) => s + mix[k], 0);

  // Per-typology target: GFA-share × apartmentsGFA / (typologies in same category) / interior.
  const targets = useMemo(() => {
    return typologies.map((t) => {
      const k = TYPOLOGY_KEYS.find((kk) => CATEGORY_FOR_TYPOLOGY_KEY[kk] === t.category);
      const pct = k ? mix[k] : 0;
      const sameCat = typologies.filter((x) => x.category === t.category).length || 1;
      const allocatedGFA = apartmentsGFA * pct / sameCat;
      const units = t.internalArea > 0 ? Math.round(allocatedGFA / t.internalArea) : 0;
      return { typology: t, units, allocatedGFA, sameCat };
    });
  }, [typologies, mix, apartmentsGFA]);

  const totalUnits = targets.reduce((s, x) => s + x.units, 0);
  const actualInteriorGFA = targets.reduce((s, x) => s + x.units * x.typology.internalArea, 0);
  const interiorGFADrift = actualInteriorGFA - apartmentsGFA;

  function apply() {
    if (apartmentsGFA <= 0) {
      alert("Set the Residential GFA in the Setup tab first (GFA breakdown → Residential).");
      return;
    }
    if (totalUnits <= 0) {
      alert("Unit counts would all round to zero — typology interior areas are too large for the Apartments GFA target.");
      return;
    }
    if (existingProgramCount > 0) {
      const ok = confirm(
        `Replace every existing cell in the Program matrix? The matrix will be filled with ${totalUnits} units distributed across ${numFloors} floors so that Σ Interior GFA ≈ ${Math.round(apartmentsGFA).toLocaleString("en-US")} m².`,
      );
      if (!ok) return;
    }
    const cellsByFloor: Record<number, { typologyId: string; count: number }[]> = {};
    for (let f = 1; f <= numFloors; f++) cellsByFloor[f] = [];
    for (const { typology, units } of targets) {
      if (units <= 0) continue;
      const perFloor = Math.floor(units / Math.max(1, numFloors));
      const remainder = units - perFloor * numFloors;
      for (let f = 1; f <= numFloors; f++) {
        const cnt = perFloor + (f <= remainder ? 1 : 0);
        if (cnt > 0) cellsByFloor[f].push({ typologyId: typology.id, count: cnt });
      }
    }
    onApply(cellsByFloor);
  }

  return (
    <div className="card bg-qube-50 border-qube-200">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="text-[28px] font-light text-qube-700 tabular-nums leading-none">{letter}</div>
        <div className="flex-1 min-w-[260px]">
          <div className="eyebrow text-qube-800 text-[10px]">Auto-fill from class mix</div>
          <p className="text-[12px] text-ink-700 mt-1 leading-snug">
            Distributes units across the matrix using class {letter}&apos;s typology mix and
            the <strong>Apartments GFA</strong> from Setup as the target. After applying,
            <em> Σ count × Interior</em> in Program should equal the Apartments GFA target.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div>
              <div className="eyebrow text-ink-500 text-[10px]">Apartments GFA target</div>
              <div className="text-[16px] font-medium text-qube-800 tabular-nums">
                {apartmentsGFA > 0 ? `${Math.round(apartmentsGFA).toLocaleString("en-US")} m²` : "—"}
              </div>
            </div>
            <div>
              <div className="eyebrow text-ink-500 text-[10px]">Estimated total units</div>
              <div className="text-[16px] font-medium text-ink-900 tabular-nums">{totalUnits.toLocaleString("en-US")}</div>
            </div>
            <div>
              <div className="eyebrow text-ink-500 text-[10px]">After rounding · Σ Interior</div>
              <div className="text-[16px] font-medium text-ink-900 tabular-nums">
                {Math.round(actualInteriorGFA).toLocaleString("en-US")} m²
              </div>
              {Math.abs(interiorGFADrift) > 1 && (
                <div className={`text-[10.5px] ${Math.abs(interiorGFADrift) > apartmentsGFA * 0.02 ? "text-amber-700" : "text-ink-500"}`}>
                  {interiorGFADrift >= 0 ? "+" : ""}{Math.round(interiorGFADrift).toLocaleString("en-US")} m² vs target
                </div>
              )}
            </div>
            <div className="flex items-end">
              <button
                className="btn btn-primary w-full"
                onClick={apply}
                disabled={apartmentsGFA <= 0 || typologies.length === 0 || totalUnits <= 0}
              >Apply to {numFloors} floors</button>
            </div>
          </div>

          {apartmentsGFA <= 0 && (
            <p className="text-[11px] text-amber-800 mt-2 leading-snug">
              No Apartments GFA detected. Set <strong>Residential</strong> in Setup&apos;s GFA breakdown
              (and the Apartments share of the residential sub-breakdown) to enable auto-fill.
            </p>
          )}

          {droppedKeys.length > 0 && apartmentsGFA > 0 && (
            <p className="text-[11px] text-amber-800 mt-2 leading-snug">
              {(droppedShare * 100).toFixed(1)}% of the class mix has no matching typology in the
              project — those units are dropped (categories: {droppedKeys.join(", ")}).
              Add a typology of that category in the Typologies tab to capture them.
            </p>
          )}

          {targets.length > 0 && totalUnits > 0 && (
            <div className="mt-4">
              <div className="eyebrow text-ink-500 text-[10px] mb-2">Per typology · target units</div>
              <table className="w-full text-[11.5px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-500">
                    <th className="text-left py-1 font-medium">Typology</th>
                    <th className="text-right py-1 font-medium">Mix %</th>
                    <th className="text-right py-1 font-medium">Interior / unit</th>
                    <th className="text-right py-1 font-medium">Allocated GFA</th>
                    <th className="text-right py-1 font-medium">Units</th>
                    <th className="text-right py-1 font-medium">Units / floor</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((x) => {
                    const k = TYPOLOGY_KEYS.find((kk) => CATEGORY_FOR_TYPOLOGY_KEY[kk] === x.typology.category);
                    const pct = k ? mix[k] : 0;
                    const sharePct = pct / x.sameCat;
                    return (
                      <tr key={x.typology.id} className="border-t border-qube-200/60">
                        <td className="py-1 text-ink-900">{x.typology.name}</td>
                        <td className="py-1 text-right text-ink-700">{(sharePct * 100).toFixed(1)}%</td>
                        <td className="py-1 text-right text-ink-700">{x.typology.internalArea.toFixed(1)} m²</td>
                        <td className="py-1 text-right text-ink-700">{Math.round(x.allocatedGFA).toLocaleString("en-US")} m²</td>
                        <td className="py-1 text-right text-ink-900 font-medium">{x.units}</td>
                        <td className="py-1 text-right text-ink-700">
                          {numFloors > 0 ? (x.units / numFloors).toFixed(1) : "—"}
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
    </div>
  );
}
