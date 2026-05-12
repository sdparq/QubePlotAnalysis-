"use client";
import { useEffect, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import { DUBAI_ZONES } from "@/lib/standards/dubai";

const M2_TO_SQFT = 10.7639;

function fmtSqft(m2: number): string {
  if (!Number.isFinite(m2) || m2 === 0) return "—";
  const sqft = m2 * M2_TO_SQFT;
  return `${Math.round(sqft).toLocaleString("en-US")} sqft`;
}

export default function SetupTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);

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
          <Field label="Dubai zone">
            <select className="cell-input" value={project.zone} onChange={(e) => patch({ zone: e.target.value })}>
              {DUBAI_ZONES.map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Plot area (m²)" hint={`≈ ${fmtSqft(project.plotArea)}`}>
            <NumInput value={project.plotArea} onChange={(v) => patch({ plotArea: v })} />
          </Field>
          <Field label="Number of residential floors">
            <NumInput value={project.numFloors} onChange={(v) => patch({ numFloors: Math.max(1, Math.round(v)) })} />
          </Field>
          <Field label="Floor-to-floor height (m)">
            <NumInput value={project.floorHeight} step={0.1} onChange={(v) => patch({ floorHeight: v })} />
          </Field>
          <Field label="Approx. shafts per unit (m²)" hint={`≈ ${fmtSqft(project.shaftPerUnit)}`}>
            <NumInput value={project.shaftPerUnit} step={0.1} onChange={(v) => patch({ shaftPerUnit: v })} />
          </Field>
          <Field label="PRM parking %">
            <NumInput value={project.prmPercent * 100} step={0.5} onChange={(v) => patch({ prmPercent: v / 100 })} suffix="%" />
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
