"use client";
import dynamic from "next/dynamic";
import { useStore, useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt2, fmtPct } from "@/lib/format";

const MassingScene = dynamic(() => import("./massing-scene"), {
  ssr: false,
  loading: () => (
    <div className="aspect-[4/3] border border-ink-200 bg-bone-100 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-3" />
        <div className="text-xs text-ink-500 uppercase tracking-[0.18em]">Loading 3D viewer…</div>
      </div>
    </div>
  ),
});

export default function MassingTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const program = computeProgram(project);

  // Derive plot dimensions: explicit fields, else square fallback from plot area
  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;

  const sFront = project.setbackFront ?? 0;
  const sRear = project.setbackRear ?? 0;
  const sSide = project.setbackSide ?? 0;

  const buildableW = Math.max(0, frontage - 2 * sSide);
  const buildableD = Math.max(0, depth - sFront - sRear);
  const buildableArea = buildableW * buildableD;
  const buildingHeight = project.numFloors * project.floorHeight;

  // Building footprint: derive from total GFA / num floors, fit aspect to buildable
  const avgFloorArea = project.numFloors > 0 ? program.totalGFABuilding / project.numFloors : 0;
  let buildingW = 0;
  let buildingD = 0;
  if (avgFloorArea > 0 && buildableW > 0 && buildableD > 0) {
    const aspect = buildableW / buildableD;
    buildingW = Math.sqrt(avgFloorArea * aspect);
    buildingD = avgFloorArea / buildingW;
  }
  const exceedsBuildable = buildingW > buildableW + 0.01 || buildingD > buildableD + 0.01;
  const coverageOfBuildable = buildableArea > 0 ? (buildingW * buildingD) / buildableArea : 0;
  const plotCoverage = project.plotArea > 0 ? (buildingW * buildingD) / project.plotArea : 0;
  const computedFar = project.plotArea > 0 ? program.totalGFABuilding / project.plotArea : 0;

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Massing study · 3D</h2>
          <p className="section-sub">
            Preliminary volumetric study. The building footprint is derived from the total GFA divided by the number of
            floors, sized to match the buildable area aspect ratio. Drag to orbit, scroll to zoom.
          </p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
          <div className="aspect-[4/3] lg:aspect-auto lg:min-h-[520px] border border-ink-200 bg-bone-100 overflow-hidden">
            <MassingScene
              frontage={frontage}
              depth={depth}
              setbackFront={sFront}
              setbackRear={sRear}
              setbackSide={sSide}
              buildingWidth={buildingW}
              buildingDepth={buildingD}
              buildingHeight={buildingHeight}
              numFloors={project.numFloors}
              floorHeight={project.floorHeight}
            />
          </div>

          <div className="grid gap-5 content-start">
            <div>
              <div className="eyebrow text-ink-500 mb-2">Plot dimensions (m)</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Frontage">
                  <NumInput value={project.plotFrontage} onChange={(v) => patch({ plotFrontage: v })} placeholder={sqRoot.toFixed(1)} />
                </Field>
                <Field label="Depth">
                  <NumInput value={project.plotDepth} onChange={(v) => patch({ plotDepth: v })} placeholder={sqRoot.toFixed(1)} />
                </Field>
              </div>
              <p className="text-[11px] text-ink-500 mt-2">
                Empty fields fall back to a square derived from plot area ({fmt2(project.plotArea)} m²).
              </p>
            </div>

            <div>
              <div className="eyebrow text-ink-500 mb-2">Setbacks (m)</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Front">
                  <NumInput value={project.setbackFront} onChange={(v) => patch({ setbackFront: v })} step={0.5} />
                </Field>
                <Field label="Rear">
                  <NumInput value={project.setbackRear} onChange={(v) => patch({ setbackRear: v })} step={0.5} />
                </Field>
                <Field label="Sides">
                  <NumInput value={project.setbackSide} onChange={(v) => patch({ setbackSide: v })} step={0.5} />
                </Field>
              </div>
            </div>

            <div className="border-t border-ink-200 pt-4 grid gap-2 text-sm">
              <Stat label="Plot area" value={`${fmt2(frontage * depth)} m²`} sub={project.plotArea > 0 && Math.abs(frontage * depth - project.plotArea) > 1 ? `entered: ${fmt2(project.plotArea)} m²` : undefined} />
              <Stat label="Buildable" value={`${fmt2(buildableW)} × ${fmt2(buildableD)} m`} sub={`${fmt2(buildableArea)} m²`} />
              <Stat label="Building height" value={`${fmt2(buildingHeight)} m`} sub={`${project.numFloors} floors × ${project.floorHeight} m`} />
              <Stat label="Avg floor area" value={`${fmt2(avgFloorArea)} m²`} sub="Total GFA / floors" />
              <Stat label="Building footprint" value={`${fmt2(buildingW)} × ${fmt2(buildingD)} m`} sub={`${fmt2(buildingW * buildingD)} m²`} />
              <Stat label="Coverage / buildable" value={fmtPct(coverageOfBuildable)} good={!exceedsBuildable} bad={exceedsBuildable} />
              <Stat label="Coverage / plot" value={fmtPct(plotCoverage)} />
              <Stat label="FAR" value={computedFar.toFixed(2)} sub="GFA / plot area" />
            </div>

            {exceedsBuildable && (
              <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs">
                <strong className="font-semibold">Footprint exceeds buildable area.</strong>
                <div className="mt-1 text-amber-800">
                  Either reduce GFA, increase number of floors, or revise setbacks. The building is shown at its derived
                  size — overflow visible in 3D.
                </div>
              </div>
            )}

            <div className="border-t border-ink-200 pt-3 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
              <span className="inline-block w-3 h-3 bg-[#ede9df] border border-[#3f5135]" />
              Plot
              <span className="inline-block w-3 h-3 bg-[#bccab0] ml-3" />
              Buildable
              <span className="inline-block w-3 h-3 bg-[#647d57] ml-3" />
              Building
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({
  value, onChange, step = 0.1, placeholder,
}: { value: number | undefined; onChange: (v: number | undefined) => void; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      step={step}
      min={0}
      className="cell-input text-right"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        const n = parseFloat(raw);
        onChange(Number.isFinite(n) && n >= 0 ? n : undefined);
      }}
    />
  );
}

function Stat({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  const cls = bad ? "text-red-700" : good ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-ink-500 text-xs">{label}</span>
      <span className={`font-medium tabular-nums text-right ${cls}`}>
        {value}
        {sub && <span className="block text-[10.5px] text-ink-500 font-normal mt-0.5">{sub}</span>}
      </span>
    </div>
  );
}
