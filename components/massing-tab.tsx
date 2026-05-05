"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useStore, useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt2, fmtPct } from "@/lib/format";
import {
  type Point,
  edgeLengths,
  offsetPolygon,
  polygonArea,
  polygonCentroid,
  polygonPerimeter,
  rectanglePlotPolygon,
  rectangleToPolygon,
  scalePolygon,
  scalePolygonToArea,
} from "@/lib/geom";

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

  const mode = project.plotMode === "polygon" ? "polygon" : "rectangular";

  // ---- derive plot polygon ----
  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;

  const sFront = project.setbackFront ?? 0;
  const sRear = project.setbackRear ?? 0;
  const sSide = project.setbackSide ?? 0;
  const sUniform = project.setbackUniform ?? Math.max(sFront, sRear, sSide, 3);

  const plotPoly: Point[] = useMemo(() => {
    if (mode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
      return project.plotPolygon;
    }
    return rectanglePlotPolygon(frontage, depth);
  }, [mode, project.plotPolygon, frontage, depth]);

  const buildablePoly: Point[] = useMemo(() => {
    if (mode === "polygon") return offsetPolygon(plotPoly, sUniform);
    return rectangleToPolygon(frontage, depth, sFront, sRear, sSide);
  }, [mode, plotPoly, sUniform, frontage, depth, sFront, sRear, sSide]);

  const plotPolyArea = polygonArea(plotPoly);
  const buildableArea = polygonArea(buildablePoly);
  const buildingHeight = project.numFloors * project.floorHeight;
  const avgFloorArea = project.numFloors > 0 ? program.totalGFABuilding / project.numFloors : 0;

  // ---- derive building footprint by scaling buildable polygon to target floor area ----
  const buildingPoly: Point[] = useMemo(() => {
    if (buildablePoly.length < 3 || avgFloorArea < 1) return [];
    // Scale around centroid, but cap at buildable size
    const scaled = scalePolygonToArea(buildablePoly, Math.min(avgFloorArea, buildableArea));
    return scaled.length >= 3 ? scaled : [];
  }, [buildablePoly, avgFloorArea, buildableArea]);

  const exceedsBuildable = avgFloorArea > buildableArea + 0.01 && buildableArea > 0;
  const coverageOfBuildable = buildableArea > 0 ? Math.min(1, avgFloorArea / buildableArea) : 0;
  const plotCoverage = plotPolyArea > 0 ? Math.min(1, avgFloorArea / plotPolyArea) : 0;
  const computedFar = plotPolyArea > 0 ? program.totalGFABuilding / plotPolyArea : 0;

  // ---- vertex editor handlers ----
  function setMode(next: "rectangular" | "polygon") {
    if (next === "polygon" && (!project.plotPolygon || project.plotPolygon.length < 3)) {
      // Seed polygon from current rectangular geometry
      patch({ plotMode: "polygon", plotPolygon: rectanglePlotPolygon(frontage, depth) });
    } else {
      patch({ plotMode: next });
    }
  }

  function updateVertex(i: number, p: Partial<Point>) {
    if (!project.plotPolygon) return;
    const next = project.plotPolygon.map((v, idx) => (idx === i ? { ...v, ...p } : v));
    patch({ plotPolygon: next });
  }

  function addVertexAfter(i: number) {
    if (!project.plotPolygon) return;
    const a = project.plotPolygon[i];
    const b = project.plotPolygon[(i + 1) % project.plotPolygon.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const next = [...project.plotPolygon.slice(0, i + 1), mid, ...project.plotPolygon.slice(i + 1)];
    patch({ plotPolygon: next });
  }

  function deleteVertex(i: number) {
    if (!project.plotPolygon) return;
    if (project.plotPolygon.length <= 3) {
      alert("A polygon needs at least 3 vertices.");
      return;
    }
    const next = project.plotPolygon.filter((_, idx) => idx !== i);
    patch({ plotPolygon: next });
  }

  function recentrePolygon() {
    if (!project.plotPolygon) return;
    const c = polygonCentroid(project.plotPolygon);
    const next = project.plotPolygon.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    patch({ plotPolygon: next });
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="section-title">Massing study · 3D</h2>
            <p className="section-sub">
              Preliminary volumetric study. Building footprint = total GFA / number of floors, scaled to the buildable
              area shape. Drag to orbit, scroll to zoom.
            </p>
          </div>
          <div className="inline-flex border border-ink-200 bg-bone-50">
            <button
              onClick={() => setMode("rectangular")}
              className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "rectangular" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >Rectangular</button>
            <button
              onClick={() => setMode("polygon")}
              className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "polygon" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >Polygon (irregular)</button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <div className="aspect-[4/3] lg:aspect-auto lg:min-h-[560px] border border-ink-200 bg-bone-100 overflow-hidden">
            <MassingScene
              plot={plotPoly}
              buildable={buildablePoly}
              building={buildingPoly}
              buildingHeight={buildingHeight}
              numFloors={project.numFloors}
              floorHeight={project.floorHeight}
              showFrontMarker={mode === "rectangular"}
            />
          </div>

          <div className="grid gap-5 content-start">
            {mode === "rectangular" ? (
              <RectangularInputs
                project={project}
                patch={patch}
                placeholder={sqRoot.toFixed(1)}
              />
            ) : (
              <PolygonInputs
                vertices={project.plotPolygon ?? []}
                setbackUniform={sUniform}
                onSetback={(v) => patch({ setbackUniform: v })}
                onUpdate={updateVertex}
                onAddAfter={addVertexAfter}
                onDelete={deleteVertex}
                onRecentre={recentrePolygon}
              />
            )}

            <div className="border-t border-ink-200 pt-4 grid gap-2 text-sm">
              <Stat
                label="Plot area"
                value={`${fmt2(plotPolyArea)} m²`}
                sub={
                  project.plotArea > 0 && Math.abs(plotPolyArea - project.plotArea) > 1
                    ? `entered: ${fmt2(project.plotArea)} m²`
                    : undefined
                }
              />
              <Stat label="Buildable" value={`${fmt2(buildableArea)} m²`} />
              <Stat label="Building height" value={`${fmt2(buildingHeight)} m`} sub={`${project.numFloors} × ${project.floorHeight} m`} />
              <Stat label="Avg floor area" value={`${fmt2(avgFloorArea)} m²`} sub="Total GFA / floors" />
              <Stat
                label="Coverage / buildable"
                value={fmtPct(coverageOfBuildable)}
                good={!exceedsBuildable}
                bad={exceedsBuildable}
              />
              <Stat label="Coverage / plot" value={fmtPct(plotCoverage)} />
              <Stat label="FAR" value={computedFar.toFixed(2)} sub="GFA / plot area" />
            </div>

            {exceedsBuildable && (
              <div className="border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs">
                <strong className="font-semibold">Floor area exceeds buildable footprint.</strong>
                <div className="mt-1 text-amber-800">
                  Either reduce GFA, increase number of floors, or revise setbacks. Building shown clamped to
                  the buildable polygon.
                </div>
              </div>
            )}

            <div className="border-t border-ink-200 pt-3 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-ink-500 flex-wrap">
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

/* -------------------- subcomponents -------------------- */

function RectangularInputs({
  project, patch, placeholder,
}: {
  project: ReturnType<typeof useProject>;
  patch: (p: Partial<ReturnType<typeof useProject>>) => void;
  placeholder: string;
}) {
  return (
    <>
      <div>
        <div className="eyebrow text-ink-500 mb-2">Plot dimensions (m)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frontage">
            <NumInput value={project.plotFrontage} onChange={(v) => patch({ plotFrontage: v })} placeholder={placeholder} />
          </Field>
          <Field label="Depth">
            <NumInput value={project.plotDepth} onChange={(v) => patch({ plotDepth: v })} placeholder={placeholder} />
          </Field>
        </div>
        <p className="text-[11px] text-ink-500 mt-2">
          Empty fields fall back to a square derived from plot area.
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
    </>
  );
}

function PolygonInputs({
  vertices, setbackUniform, onSetback, onUpdate, onAddAfter, onDelete, onRecentre,
}: {
  vertices: Point[];
  setbackUniform: number;
  onSetback: (v: number | undefined) => void;
  onUpdate: (i: number, p: Partial<Point>) => void;
  onAddAfter: (i: number) => void;
  onDelete: (i: number) => void;
  onRecentre: () => void;
}) {
  const lengths = edgeLengths(vertices);
  const perimeter = polygonPerimeter(vertices);

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow text-ink-500">Vertices (m)</div>
          <button
            onClick={onRecentre}
            className="text-[10.5px] uppercase tracking-[0.10em] text-qube-700 hover:text-qube-900"
            title="Re-centre the polygon at the origin"
          >Centre</button>
        </div>
        <div className="border border-ink-200">
          <div className="grid grid-cols-[28px_1fr_1fr_92px_28px] gap-1 px-2 py-1.5 text-[10.5px] uppercase tracking-[0.10em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <span>#</span><span>X</span><span>Y</span><span className="text-right">Edge →</span><span></span>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {vertices.map((v, i) => (
              <div key={i} className="grid grid-cols-[28px_1fr_1fr_92px_28px] gap-1 px-2 py-1 items-center border-b border-ink-100 last:border-b-0">
                <span className="text-[11px] text-ink-500 tabular-nums">{i + 1}</span>
                <input
                  type="number"
                  step={0.01}
                  className="cell-input text-right"
                  value={v.x}
                  onChange={(e) => onUpdate(i, { x: parseFloat(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  step={0.01}
                  className="cell-input text-right"
                  value={v.y}
                  onChange={(e) => onUpdate(i, { y: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-right text-[11px] text-ink-700 tabular-nums" title={`Length to vertex ${((i + 1) % vertices.length) + 1}`}>
                  {fmt2(lengths[i] ?? 0)} m
                </span>
                <button
                  onClick={() => onDelete(i)}
                  className="text-ink-400 hover:text-red-700 text-base leading-none"
                  title="Delete vertex"
                  aria-label="Delete vertex"
                >×</button>
                {/* Insertion handle below each row */}
                <span></span>
                <span className="col-span-3 -mt-0.5 -mb-0.5">
                  <button
                    onClick={() => onAddAfter(i)}
                    className="block w-full text-[10px] text-ink-400 hover:text-qube-700 hover:bg-qube-50 py-0.5"
                    title="Insert vertex after this one"
                  >+ insert vertex here</button>
                </span>
                <span></span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-ink-500 flex justify-between">
          <span>{vertices.length} vertices</span>
          <span className="tabular-nums">Perimeter: {fmt2(perimeter)} m</span>
        </div>
        <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
          Enter each corner&rsquo;s X / Y in metres (any origin). The edge length on the right of each row should
          match the cota on your drawing.
        </p>
      </div>

      <div>
        <div className="eyebrow text-ink-500 mb-2">Setback (m)</div>
        <Field label="Uniform setback applied to every edge">
          <NumInput value={setbackUniform} onChange={onSetback} step={0.5} />
        </Field>
      </div>
    </>
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
      className="cell-input text-right"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        const n = parseFloat(raw);
        onChange(Number.isFinite(n) ? n : undefined);
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
