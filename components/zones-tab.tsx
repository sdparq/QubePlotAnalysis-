"use client";
import { useState } from "react";
import {
  ALL_CLASS_LETTERS,
  TYPOLOGY_KEYS,
  TYPOLOGY_LABELS,
  type TypologyKey,
  type ZoneClass,
  type ZoneClassRow,
} from "@/lib/zone-classes";
import { useZoneLibrary } from "@/lib/use-zone-library";

type Section =
  | "overview"
  | "locations"
  | "typologyMix"
  | "avgArea"
  | "salePrice"
  | "floorHeights"
  | "construction"
  | "misc";

const SECTION_LABELS: { id: Section; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "Class names + descriptions." },
  { id: "locations", label: "Locations", hint: "Which Dubai zones fall in each class." },
  { id: "typologyMix", label: "Typology mix", hint: "Share of each unit type (sums to 100%)." },
  { id: "avgArea", label: "Average areas (SqFt)", hint: "Typical sellable area per unit type." },
  { id: "salePrice", label: "Sale price (AED/SqFt)", hint: "Indicative GSA price range." },
  { id: "floorHeights", label: "Floor heights (m)", hint: "Typical floor-to-floor per section." },
  { id: "construction", label: "Construction price (AED/SqFt BUA)", hint: "By building-height tier." },
  { id: "misc", label: "Misc", hint: "Balcony %, parking, design fee." },
];

export default function ZonesTab() {
  const { library, hydrated, updateClass, resetAll, resetClass } = useZoneLibrary();
  const [section, setSection] = useState<Section>("overview");

  if (!hydrated) return null;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="section-title">Class library · Dubai</h2>
            <p className="section-sub">
              QUBE&apos;s reference matrix of Dubai real-estate classes
              (A&nbsp;&middot; Most luxurious &rarr; G&nbsp;&middot; Economical).
              Each class groups zones with similar typology mix, prices, floor
              heights and parking standard. Everything below is editable and
              shared across every project — your changes persist in this
              browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirm("Restore the whole library to its seed values?")) resetAll();
              }}
              className="text-[11px] uppercase tracking-[0.10em] text-ink-500 hover:text-ink-900 underline"
            >Reset all</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-1 flex-wrap mb-4">
          {SECTION_LABELS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] border ${
                section === s.id
                  ? "bg-qube-500 text-white border-qube-500"
                  : "border-ink-200 text-ink-700 hover:bg-bone-50"
              }`}
            >{s.label}</button>
          ))}
        </div>
        <p className="text-[11.5px] text-ink-500 mb-4 leading-snug">
          {SECTION_LABELS.find((s) => s.id === section)?.hint}
        </p>

        {section === "overview" && <OverviewMatrix library={library} update={updateClass} resetClass={resetClass} />}
        {section === "locations" && <LocationsMatrix library={library} update={updateClass} />}
        {section === "typologyMix" && <TypologyMixMatrix library={library} update={updateClass} />}
        {section === "avgArea" && <AvgAreaMatrix library={library} update={updateClass} />}
        {section === "salePrice" && <SalePriceMatrix library={library} update={updateClass} />}
        {section === "floorHeights" && <FloorHeightsMatrix library={library} update={updateClass} />}
        {section === "construction" && <ConstructionMatrix library={library} update={updateClass} />}
        {section === "misc" && <MiscMatrix library={library} update={updateClass} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Section views                               */
/* -------------------------------------------------------------------------- */

function OverviewMatrix({
  library, update, resetClass,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
  resetClass: (l: ZoneClass) => void;
}) {
  return (
    <div className="grid gap-4">
      {ALL_CLASS_LETTERS.map((letter) => {
        const row = library[letter];
        return (
          <div key={letter} className="border border-ink-200 p-4 grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <span className="text-[26px] font-light text-qube-700 tabular-nums">{letter}</span>
                <input
                  className="cell-input !text-[14px] !font-medium"
                  value={row.name}
                  onChange={(e) => update(letter, { name: e.target.value })}
                />
              </div>
              <button
                onClick={() => resetClass(letter)}
                className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500 hover:text-ink-900 underline"
              >Reset class {letter}</button>
            </div>
            <textarea
              className="cell-input min-h-[60px] leading-snug text-[12px]"
              rows={2}
              value={row.description}
              onChange={(e) => update(letter, { description: e.target.value })}
            />
            <div className="text-[10.5px] text-ink-500">
              {row.locations.length} zone{row.locations.length === 1 ? "" : "s"} in this class.
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LocationsMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
      {ALL_CLASS_LETTERS.map((letter) => {
        const row = library[letter];
        return (
          <div key={letter} className="border border-ink-200 p-3 grid gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-light text-qube-700">{letter}</span>
              <span className="text-[11px] text-ink-500">{row.name}</span>
            </div>
            <textarea
              className="cell-input text-[11.5px] leading-snug font-mono"
              rows={Math.max(5, row.locations.length + 1)}
              value={row.locations.join("\n")}
              onChange={(e) =>
                update(letter, { locations: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="One zone per line"
            />
            <div className="text-[10.5px] text-ink-500">{row.locations.length} zones</div>
          </div>
        );
      })}
    </div>
  );
}

function TypologyMixMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  return (
    <NumberMatrix
      library={library}
      update={update}
      rowFor={(letter) => library[letter].typologyMix}
      setRow={(letter, key, val) =>
        update(letter, { typologyMix: { ...library[letter].typologyMix, [key]: val / 100 } })
      }
      getDisplay={(v) => `${(v * 100).toFixed(1)}`}
      suffix="%"
      footerLabel="Σ"
      footerFor={(letter) => {
        const sum = Object.values(library[letter].typologyMix).reduce((a, b) => a + b, 0);
        return `${(sum * 100).toFixed(1)} %`;
      }}
    />
  );
}

function AvgAreaMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  return (
    <RangeMatrix
      library={library}
      update={update}
      rowFor={(letter) => library[letter].avgAreaSqft}
      setRow={(letter, key, range) =>
        update(letter, { avgAreaSqft: { ...library[letter].avgAreaSqft, [key]: range } })
      }
      suffix="sqft"
    />
  );
}

function SalePriceMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  return (
    <RangeMatrix
      library={library}
      update={update}
      rowFor={(letter) => library[letter].salePriceAedPerSqft}
      setRow={(letter, key, range) =>
        update(letter, { salePriceAedPerSqft: { ...library[letter].salePriceAedPerSqft, [key]: range } })
      }
      suffix="AED"
    />
  );
}

function FloorHeightsMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  const rows: { key: keyof ZoneClassRow["floorHeights"]; label: string }[] = [
    { key: "basement", label: "Basement" },
    { key: "ground", label: "Ground floor" },
    { key: "podium", label: "Podium" },
    { key: "firstFloor", label: "First residential floor" },
    { key: "typical", label: "Typical residential floor" },
  ];
  return (
    <div className="border border-ink-200 overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="bg-bone-50 border-b border-ink-200">
            <th className="text-left px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">Section</th>
            {ALL_CLASS_LETTERS.map((l) => (
              <th key={l} className="px-2 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-ink-100">
              <td className="px-3 py-1 text-ink-700">{r.label}</td>
              {ALL_CLASS_LETTERS.map((l) => (
                <td key={l} className="px-1 py-1">
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    className="cell-input text-right !py-1 !px-1.5 w-full"
                    value={library[l].floorHeights[r.key]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      update(l, { floorHeights: { ...library[l].floorHeights, [r.key]: v } });
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConstructionMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  const rows: { key: keyof ZoneClassRow["constructionAedPerSqftBua"]; label: string }[] = [
    { key: "lowRise", label: "Low rise (≤ 15 m)" },
    { key: "midRise", label: "Mid rise (15–23 m)" },
    { key: "highRise", label: "High rise (23–90 m)" },
    { key: "superHigh", label: "Super high (> 90 m)" },
    { key: "superHigh180", label: "> 180 m" },
    { key: "superHigh270", label: "> 270 m" },
  ];
  return (
    <div className="border border-ink-200 overflow-x-auto">
      <table className="w-full text-[11.5px] tabular-nums">
        <thead>
          <tr className="bg-bone-50 border-b border-ink-200">
            <th className="text-left px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">Height tier</th>
            {ALL_CLASS_LETTERS.map((l) => (
              <th key={l} className="px-2 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-ink-100">
              <td className="px-3 py-1 text-ink-700">{r.label}</td>
              {ALL_CLASS_LETTERS.map((l) => {
                const range = library[l].constructionAedPerSqftBua[r.key] as [number, number];
                return (
                  <td key={l} className="px-1 py-1">
                    <div className="grid grid-cols-2 gap-1">
                      <input
                        type="number"
                        step={10}
                        min={0}
                        className="cell-input text-right !py-1 !px-1.5"
                        value={range[0]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v) || v < 0) return;
                          update(l, {
                            constructionAedPerSqftBua: {
                              ...library[l].constructionAedPerSqftBua,
                              [r.key]: [v, range[1]],
                            },
                          });
                        }}
                      />
                      <input
                        type="number"
                        step={10}
                        min={0}
                        className="cell-input text-right !py-1 !px-1.5"
                        value={range[1]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v) || v < 0) return;
                          update(l, {
                            constructionAedPerSqftBua: {
                              ...library[l].constructionAedPerSqftBua,
                              [r.key]: [range[0], v],
                            },
                          });
                        }}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-b border-ink-100">
            <td className="px-3 py-1 text-ink-700">&gt; 360 m (min, AED)</td>
            {ALL_CLASS_LETTERS.map((l) => (
              <td key={l} className="px-1 py-1">
                <input
                  type="number"
                  step={10}
                  min={0}
                  className="cell-input text-right !py-1 !px-1.5 w-full"
                  value={library[l].constructionAedPerSqftBua.superHigh360min}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isFinite(v) || v < 0) return;
                    update(l, {
                      constructionAedPerSqftBua: { ...library[l].constructionAedPerSqftBua, superHigh360min: v },
                    });
                  }}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MiscMatrix({
  library, update,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
}) {
  const rows: { key: "balconyPctOfNsa" | "parkingAreaPerCarSqft" | "designPriceAedPerSqftGfa"; label: string; step: number; format?: (v: number) => string; toStored?: (v: number) => number; }[] = [
    { key: "balconyPctOfNsa", label: "Balconies (% of NSA)", step: 0.5, format: (v) => (v * 100).toFixed(1), toStored: (v) => v / 100 },
    { key: "parkingAreaPerCarSqft", label: "Parking area / car (sqft)", step: 10 },
    { key: "designPriceAedPerSqftGfa", label: "Design fee (AED/sqft GFA)", step: 0.5 },
  ];
  return (
    <div className="border border-ink-200 overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="bg-bone-50 border-b border-ink-200">
            <th className="text-left px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">Metric</th>
            {ALL_CLASS_LETTERS.map((l) => (
              <th key={l} className="px-2 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-ink-100">
              <td className="px-3 py-1 text-ink-700">{r.label}</td>
              {ALL_CLASS_LETTERS.map((l) => {
                const stored = library[l][r.key];
                const display = r.format ? r.format(stored) : String(stored);
                return (
                  <td key={l} className="px-1 py-1">
                    <input
                      type="number"
                      step={r.step}
                      min={0}
                      className="cell-input text-right !py-1 !px-1.5 w-full"
                      value={display}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v < 0) return;
                        update(l, { [r.key]: r.toStored ? r.toStored(v) : v } as Partial<ZoneClassRow>);
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Generic matrices                              */
/* -------------------------------------------------------------------------- */

function NumberMatrix({
  library, update, rowFor, setRow, getDisplay, suffix, footerLabel, footerFor,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
  rowFor: (l: ZoneClass) => Record<TypologyKey, number>;
  setRow: (l: ZoneClass, key: TypologyKey, val: number) => void;
  getDisplay: (v: number) => string;
  suffix: string;
  footerLabel?: string;
  footerFor?: (l: ZoneClass) => string;
}) {
  return (
    <div className="border border-ink-200 overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="bg-bone-50 border-b border-ink-200">
            <th className="text-left px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">Typology</th>
            {ALL_CLASS_LETTERS.map((l) => (
              <th key={l} className="px-2 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TYPOLOGY_KEYS.map((tk) => (
            <tr key={tk} className="border-b border-ink-100">
              <td className="px-3 py-1 text-ink-700">{TYPOLOGY_LABELS[tk]}</td>
              {ALL_CLASS_LETTERS.map((l) => (
                <td key={l} className="px-1 py-1">
                  <div className="relative">
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      className="cell-input text-right !py-1 !px-1.5 pr-6 w-full"
                      value={getDisplay(rowFor(l)[tk])}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v < 0) return;
                        setRow(l, tk, v);
                      }}
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9.5px] text-ink-400 pointer-events-none">{suffix}</span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {footerLabel && footerFor && (
            <tr className="bg-qube-50 font-medium">
              <td className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-qube-800">{footerLabel}</td>
              {ALL_CLASS_LETTERS.map((l) => (
                <td key={l} className="px-1 py-1.5 text-right text-qube-800 text-[11px]">{footerFor(l)}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RangeMatrix({
  library, update, rowFor, setRow, suffix,
}: {
  library: Record<ZoneClass, ZoneClassRow>;
  update: (l: ZoneClass, p: Partial<ZoneClassRow>) => void;
  rowFor: (l: ZoneClass) => Record<TypologyKey, [number, number]>;
  setRow: (l: ZoneClass, key: TypologyKey, range: [number, number]) => void;
  suffix: string;
}) {
  return (
    <div className="border border-ink-200 overflow-x-auto">
      <table className="w-full text-[11.5px] tabular-nums">
        <thead>
          <tr className="bg-bone-50 border-b border-ink-200">
            <th className="text-left px-3 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500" rowSpan={2}>Typology</th>
            {ALL_CLASS_LETTERS.map((l) => (
              <th key={l} className="px-2 py-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-500 text-center" colSpan={2}>{l}</th>
            ))}
          </tr>
          <tr className="bg-bone-50 border-b border-ink-200">
            {ALL_CLASS_LETTERS.flatMap((l) => [
              <th key={`${l}-min`} className="px-1 py-1 text-[10px] text-ink-400">min</th>,
              <th key={`${l}-max`} className="px-1 py-1 text-[10px] text-ink-400">max</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {TYPOLOGY_KEYS.map((tk) => (
            <tr key={tk} className="border-b border-ink-100">
              <td className="px-3 py-1 text-ink-700">{TYPOLOGY_LABELS[tk]}</td>
              {ALL_CLASS_LETTERS.flatMap((l) => {
                const range = rowFor(l)[tk];
                return [
                  <td key={`${l}-min`} className="px-1 py-1">
                    <input
                      type="number"
                      step={10}
                      min={0}
                      className="cell-input text-right !py-1 !px-1.5 w-full"
                      value={range[0]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v < 0) return;
                        setRow(l, tk, [v, range[1]]);
                      }}
                    />
                  </td>,
                  <td key={`${l}-max`} className="px-1 py-1">
                    <input
                      type="number"
                      step={10}
                      min={0}
                      className="cell-input text-right !py-1 !px-1.5 w-full"
                      value={range[1]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!Number.isFinite(v) || v < 0) return;
                        setRow(l, tk, [range[0], v]);
                      }}
                    />
                  </td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10.5px] text-ink-500 px-3 py-1.5">All values in {suffix}.</div>
    </div>
  );
}
