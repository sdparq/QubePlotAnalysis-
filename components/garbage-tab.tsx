"use client";
import { useStore, useProject } from "@/lib/store";
import { computeGarbage } from "@/lib/calc/garbage";
import { fmt0, fmt2 } from "@/lib/format";
import type { GarbageOverrides } from "@/lib/types";

export default function GarbageTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const r = computeGarbage(project);

  function setOverride(key: keyof GarbageOverrides, value: number | undefined) {
    const next = { ...(project.garbage ?? {}) } as GarbageOverrides;
    if (value === undefined) delete next[key];
    else next[key] = value;
    patch({ garbage: next });
  }

  function resetAll() {
    if (!confirm("Reset all waste-room parameters to Dubai DM defaults?")) return;
    patch({ garbage: undefined });
  }

  const overrides = project.garbage ?? {};
  const isOverridden = (k: keyof GarbageOverrides) => overrides[k] !== undefined;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Waste room · Dubai DM</h2>
            <p className="section-sub">
              Inputs follow Dubai Municipality residential waste guidelines. Override any value if the local sub-municipality
              uses different rates.
            </p>
          </div>
          <button className="btn btn-secondary btn-xs" onClick={resetAll}>Reset to Dubai DM defaults</button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="Generation rate (kg / 100 m² / day)" overridden={isOverridden("generationKgPer100sqmPerDay")} onClear={() => setOverride("generationKgPer100sqmPerDay", undefined)}>
            <NumInput value={r.generationKgPer100sqmPerDay} step={0.5} onChange={(v) => setOverride("generationKgPer100sqmPerDay", v)} />
          </Field>
          <Field label="Storage capacity (days)" overridden={isOverridden("storageDays")} onClear={() => setOverride("storageDays", undefined)}>
            <NumInput value={r.storageDays} step={1} min={1} onChange={(v) => setOverride("storageDays", Math.max(1, Math.round(v)))} />
          </Field>
          <Field label="Waste density (kg / m³)" overridden={isOverridden("densityKgPerM3")} onClear={() => setOverride("densityKgPerM3", undefined)}>
            <NumInput value={r.densityKgPerM3} step={5} onChange={(v) => setOverride("densityKgPerM3", v)} />
          </Field>
          <Field label="Container capacity (m³)" overridden={isOverridden("containerCapacityM3")} onClear={() => setOverride("containerCapacityM3", undefined)}>
            <NumInput value={r.containerCapacityM3} step={0.1} onChange={(v) => setOverride("containerCapacityM3", v)} />
          </Field>
          <Field label="Container width (m)" overridden={isOverridden("containerWidthM")} onClear={() => setOverride("containerWidthM", undefined)}>
            <NumInput value={r.containerWidthM} step={0.01} onChange={(v) => setOverride("containerWidthM", v)} />
          </Field>
          <Field label="Container length (m)" overridden={isOverridden("containerLengthM")} onClear={() => setOverride("containerLengthM", undefined)}>
            <NumInput value={r.containerLengthM} step={0.01} onChange={(v) => setOverride("containerLengthM", v)} />
          </Field>
          <Field label="Separation between containers (m)" overridden={isOverridden("separationM")} onClear={() => setOverride("separationM", undefined)}>
            <NumInput value={r.separationM} step={0.01} onChange={(v) => setOverride("separationM", v)} />
          </Field>
          <Field label="Front clearance (m)" overridden={isOverridden("frontClearanceM")} onClear={() => setOverride("frontClearanceM", undefined)}>
            <NumInput value={r.frontClearanceM} step={0.05} onChange={(v) => setOverride("frontClearanceM", v)} />
          </Field>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title mb-5">Calculation</h2>
        <table className="tbl w-full">
          <colgroup>
            <col />
            <col style={{ width: 160 }} />
            <col style={{ width: 80 }} />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>Parameter</th>
              <th className="text-right">Value</th>
              <th>Unit</th>
              <th>Formula / Source</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Residential GFA" value={fmt2(r.residentialGFA)} unit="m²" note="From Program — sum of unit interiors" />
            <Row
              label="Daily waste generation"
              value={fmt2(r.dailyWasteKg)}
              unit="kg / day"
              note={`GFA × ${r.generationKgPer100sqmPerDay} / 100`}
            />
            <Row
              label={`Storage capacity (${r.storageDays} days)`}
              value={fmt2(r.storageKg)}
              unit="kg"
              note="Daily generation × storage days"
            />
            <Row
              label="Volume required"
              value={fmt2(r.volumeRequiredM3)}
              unit="m³"
              note={`Capacity ÷ ${r.densityKgPerM3} kg/m³`}
            />
            <Row
              label={`N° containers (${r.containerCapacityM3} m³)`}
              value={fmt0(r.containers)}
              unit="units"
              note="Volume ÷ container capacity (rounded up)"
            />
            <Row
              label="Room width (containers side by side)"
              value={fmt2(r.roomWidthM)}
              unit="m"
              note={`N × ${r.containerWidthM} + (N+1) × ${r.separationM}`}
            />
            <Row
              label="Room depth"
              value={fmt2(r.roomDepthM)}
              unit="m"
              note={`${r.containerLengthM} + ${r.frontClearanceM} clearance`}
            />
            <tr className="row-total">
              <td>TOTAL WASTE ROOM AREA</td>
              <td className="text-right">{fmt2(r.roomAreaM2)}</td>
              <td>m²</td>
              <td>Width × depth</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Kpi label="Containers" value={fmt0(r.containers)} sub={`${r.containerCapacityM3} m³ each`} />
        <Kpi label="Room footprint" value={`${fmt2(r.roomAreaM2)} m²`} sub={`${fmt2(r.roomWidthM)} × ${fmt2(r.roomDepthM)} m`} />
        <Kpi label="Daily waste" value={`${fmt2(r.dailyWasteKg)} kg`} sub={`${fmt2(r.dailyWasteKg / 1000)} t / day`} />
      </div>
    </div>
  );
}

function Row({ label, value, unit, note }: { label: string; value: string; unit: string; note: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right tabular-nums">{value}</td>
      <td className="text-ink-500 text-xs">{unit}</td>
      <td className="text-ink-500 text-xs">{note}</td>
    </tr>
  );
}

function Field({ label, children, overridden, onClear }: { label: string; children: React.ReactNode; overridden: boolean; onClear: () => void }) {
  return (
    <label className="grid gap-2">
      <span className="eyebrow flex items-center justify-between">
        <span>{label}{overridden && <span className="text-qube-700"> *</span>}</span>
        {overridden && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onClear(); }}
            className="text-[10px] uppercase tracking-[0.10em] text-ink-400 hover:text-ink-700"
            title="Reset to default"
          >Reset</button>
        )}
      </span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, step = 1, min, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        step={step}
        min={min}
        className="cell-input pr-9"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">{suffix}</span>}
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
