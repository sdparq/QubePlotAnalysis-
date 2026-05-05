"use client";
import { useStore, useProject } from "@/lib/store";
import { DUBAI_ZONES } from "@/lib/standards/dubai";

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
          <Field label="Plot area (m²)">
            <NumInput value={project.plotArea} onChange={(v) => patch({ plotArea: v })} />
          </Field>
          <Field label="Number of residential floors">
            <NumInput value={project.numFloors} onChange={(v) => patch({ numFloors: Math.max(1, Math.round(v)) })} />
          </Field>
          <Field label="Floor-to-floor height (m)">
            <NumInput value={project.floorHeight} step={0.1} onChange={(v) => patch({ floorHeight: v })} />
          </Field>
          <Field label="Approx. shafts per unit (m²)">
            <NumInput value={project.shaftPerUnit} step={0.1} onChange={(v) => patch({ shaftPerUnit: v })} />
          </Field>
          <Field label="PRM parking %">
            <NumInput value={project.prmPercent * 100} step={0.5} onChange={(v) => patch({ prmPercent: v / 100 })} suffix="%" />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Notes</h2>
          <p className="section-sub">Free-form observations, issues, conclusions.</p>
        </div>
        <textarea
          className="cell-input min-h-[140px] leading-relaxed"
          rows={6}
          value={project.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="e.g. Travel distance exceeds 61 m max — relocate parking layout..."
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, step = 1, suffix }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        step={step}
        className="cell-input pr-9"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">{suffix}</span>}
    </div>
  );
}
