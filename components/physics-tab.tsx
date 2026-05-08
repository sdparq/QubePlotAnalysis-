"use client";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmt2, fmtPct } from "@/lib/format";
import { buildMassing } from "@/lib/massing";
import { offsetPolygon, rectanglePlotPolygon, rectangleToPolygon, type Point } from "@/lib/geom";
import {
  computePVPotential,
  computeSkyExposure,
  computeViewQuality,
  customNeighborBoxes,
  latLngToWorld,
  osmBuildingBox,
  projectBoxes,
  sampleFacadePanels,
  type Box,
  type FacadePanel,
  type PVResult,
  type SkyExposureResult,
  type ViewQualityResult,
} from "@/lib/building-physics";
import { fetchOsmBuildings } from "@/lib/osm";

const PhysicsScene = dynamic(() => import("./physics-scene"), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] border border-ink-200 bg-bone-100 flex items-center justify-center">
      <div className="text-[11px] text-ink-500 uppercase tracking-[0.18em]">Loading 3D viewer…</div>
    </div>
  ),
});

export default function PhysicsTab() {
  const project = useProject();
  const program = computeProgram(project);

  // Reproduce the same plot/buildable/volumes the Massing tab computes.
  const sqRoot = project.plotArea > 0 ? Math.sqrt(project.plotArea) : 50;
  const frontage = project.plotFrontage && project.plotFrontage > 0 ? project.plotFrontage : sqRoot;
  const depth = project.plotDepth && project.plotDepth > 0 ? project.plotDepth : sqRoot;
  const sFront = project.setbackFront ?? 0;
  const sRear = project.setbackRear ?? 0;
  const sSide = project.setbackSide ?? 0;
  const sUniform = project.setbackUniform ?? Math.max(sFront, sRear, sSide, 3);

  const plotPoly: Point[] = useMemo(() => {
    if (project.plotMode === "polygon" && project.plotPolygon && project.plotPolygon.length >= 3) {
      return project.plotPolygon;
    }
    return rectanglePlotPolygon(frontage, depth);
  }, [project.plotMode, project.plotPolygon, frontage, depth]);

  const setbackPerEdge: number[] = useMemo(() => {
    if (project.plotMode !== "polygon") return [];
    const n = plotPoly.length;
    if (project.setbackPerEdge && project.setbackPerEdge.length === n) return project.setbackPerEdge;
    return new Array(n).fill(sUniform);
  }, [project.plotMode, plotPoly.length, project.setbackPerEdge, sUniform]);

  const buildablePoly: Point[] = useMemo(() => {
    if (project.plotMode === "polygon") return offsetPolygon(plotPoly, setbackPerEdge);
    return rectangleToPolygon(frontage, depth, sFront, sRear, sSide);
  }, [project.plotMode, plotPoly, setbackPerEdge, frontage, depth, sFront, sRear, sSide]);

  const programFloorArea = project.numFloors > 0 ? program.totalGFABuilding / project.numFloors : 0;
  const effFloors = project.massingFloors ?? project.numFloors;
  const effFloorArea = project.massingFloorArea ?? programFloorArea;

  const massing = useMemo(
    () =>
      buildMassing({
        buildable: buildablePoly,
        effFloors,
        effFloorArea,
        floorHeight: project.floorHeight,
        shape: project.massingShape ?? "block",
        podiumFloors: project.podiumFloors ?? Math.min(2, effFloors),
        podiumCoverage: project.podiumCoverage ?? 0.95,
        towerCoverage: project.towerCoverage ?? 0.45,
        towerPosition: project.towerPosition ?? "C",
        courtyardRatio: project.courtyardRatio ?? 0.18,
        twinSeparation: project.twinSeparation ?? 12,
        twinCoverage: project.twinCoverage ?? 0.28,
        steppedSteps: project.steppedSteps ?? 4,
        steppedShrink: project.steppedShrink ?? 0.15,
        lNotchPosition: project.lNotchPosition ?? "NE",
        lNotchRatio: project.lNotchRatio ?? 0.32,
        uOpening: project.uOpening ?? "N",
        uArmRatio: project.uArmRatio ?? 0.28,
        uNotchDepth: project.uNotchDepth ?? 0.55,
      }),
    [buildablePoly, effFloors, effFloorArea, project],
  );

  const hasGeo =
    typeof project.latitude === "number" &&
    typeof project.longitude === "number" &&
    project.latitude !== 0 &&
    project.longitude !== 0;

  return (
    <div className="grid gap-6">
      <div className="card">
        <h2 className="section-title">Building physics · indicative</h2>
        <p className="section-sub">
          Sky exposure, view to a landmark and PV potential — all computed client-side from
          the current massing and the OSM neighbours. Each analysis paints the building&apos;s
          façades with its own colour map so you can spot weak / strong areas at a glance.
          Indicative figures, intended for early-stage massing studies.
        </p>
      </div>

      {!hasGeo && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-[12.5px] text-amber-900 leading-snug">
            <strong>Latitude / longitude not set.</strong> Sky exposure and view-to-landmark need
            the project to be geo-referenced (Setup tab) so we can fetch OSM neighbours. PV
            potential will still run on the massing alone.
          </p>
        </div>
      )}

      <SkyExposureCard
        volumes={massing.volumes}
        latitude={project.latitude ?? 0}
        longitude={project.longitude ?? 0}
        customNeighbors={project.customNeighbors ?? []}
        hasGeo={hasGeo}
      />

      <ViewQualityCard
        volumes={massing.volumes}
        latitude={project.latitude ?? 0}
        longitude={project.longitude ?? 0}
        customNeighbors={project.customNeighbors ?? []}
        hasGeo={hasGeo}
      />

      <PVCard
        volumes={massing.volumes}
        gfa={program.totalGFABuilding}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Sky exposure                               */
/* -------------------------------------------------------------------------- */

function SkyExposureCard({
  volumes,
  latitude,
  longitude,
  customNeighbors,
  hasGeo,
}: {
  volumes: ReturnType<typeof buildMassing>["volumes"];
  latitude: number;
  longitude: number;
  customNeighbors: NonNullable<ReturnType<typeof useProject>["customNeighbors"]>;
  hasGeo: boolean;
}) {
  const [panelSize, setPanelSize] = useState(6);
  const [rayCount, setRayCount] = useState(64);
  const [contextRadius, setContextRadius] = useState(350);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SkyExposureResult | null>(null);
  const [neighboursUsed, setNeighboursUsed] = useState(0);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const obstacles: Box[] = [...projectBoxes(volumes)];
      for (const cn of customNeighbors) obstacles.push(...customNeighborBoxes(cn));
      let osmCount = 0;
      if (hasGeo) {
        const osm = await fetchOsmBuildings(latitude, longitude, contextRadius);
        for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
        osmCount = osm.length;
      }
      setNeighboursUsed(osmCount + customNeighbors.length);
      const panels = sampleFacadePanels(volumes, panelSize);
      // Yield to the browser before the heavy loop.
      await new Promise((r) => setTimeout(r, 0));
      const r = computeSkyExposure(panels, obstacles, { rayCount });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [volumes, latitude, longitude, customNeighbors, hasGeo, panelSize, rayCount, contextRadius]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">Sky exposure</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            Fraction of the sky dome each façade panel sees. Useful as a first daylight indicator —
            façade areas with sky access &lt; 20-25% are likely to need design attention.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50 transition-colors"
        >
          {running ? "Running…" : result ? "Re-run" : "Run analysis"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <SmallNumField label="Panel size (m)" value={panelSize} step={1} min={2} max={20}
          onChange={setPanelSize} hint="Lower = finer, slower." />
        <SmallNumField label="Rays per panel" value={rayCount} step={8} min={16} max={256}
          onChange={setRayCount} hint="64 is a balanced default." />
        <SmallNumField label="Context radius (m)" value={contextRadius} step={50} min={100} max={1500}
          onChange={setContextRadius} hint="OSM fetch radius." />
      </div>

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Average sky exposure" value={fmtPct(result.averagePct)} good={result.averagePct >= 0.4} />
            <Stat label="Façade < 25% sky" value={fmtPct(result.pctAreaBelow25)} bad={result.pctAreaBelow25 > 0.3} />
            <Stat label="Façade < 20% sky" value={fmtPct(result.pctAreaBelow20)} bad={result.pctAreaBelow20 > 0.2} />
            <Stat label="Panels evaluated"
              value={`${result.panelCount}`}
              sub={`${neighboursUsed} neighbours used as occluders`} />
          </div>

          <div className="border border-ink-200 mb-4">
            <div className="aspect-[16/9] bg-bone-50">
              <PhysicsScene volumes={volumes} panelValues={result.panelValues} scheme="viridis" />
            </div>
            <ColorRamp scheme="viridis" leftLabel="0 % sky" rightLabel="100 % sky" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="eyebrow text-ink-500 mb-2 text-[10.5px]">By orientation</div>
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="border-b border-ink-200">
                    <th className="text-left py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Orient.</th>
                    <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Area m²</th>
                    <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Avg sky</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byOrientation.map((o) => (
                    <tr key={o.name} className="border-b border-ink-100">
                      <td className="py-1 text-ink-900">{o.name}</td>
                      <td className="py-1 text-right text-ink-700">{fmt0(o.areaM2)}</td>
                      <td className="py-1 text-right text-ink-900">{fmtPct(o.avgPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="eyebrow text-ink-500 mb-2 text-[10.5px]">Distribution by sky-fraction bin</div>
              <Histogram data={result.histogram.map((h) => ({ label: h.bin, value: h.areaM2 }))} unit="m²" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          View quality on a landmark                        */
/* -------------------------------------------------------------------------- */

function ViewQualityCard({
  volumes,
  latitude,
  longitude,
  customNeighbors,
  hasGeo,
}: {
  volumes: ReturnType<typeof buildMassing>["volumes"];
  latitude: number;
  longitude: number;
  customNeighbors: NonNullable<ReturnType<typeof useProject>["customNeighbors"]>;
  hasGeo: boolean;
}) {
  const [landmarkLat, setLandmarkLat] = useState<number | "">("");
  const [landmarkLng, setLandmarkLng] = useState<number | "">("");
  const [landmarkY, setLandmarkY] = useState(20);
  const [panelSize, setPanelSize] = useState(6);
  const [contextRadius, setContextRadius] = useState(500);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ViewQualityResult | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      if (!hasGeo) throw new Error("Set the project's latitude/longitude in Setup first.");
      if (typeof landmarkLat !== "number" || typeof landmarkLng !== "number") {
        throw new Error("Enter the landmark's latitude and longitude.");
      }
      const obstacles: Box[] = [...projectBoxes(volumes)];
      for (const cn of customNeighbors) obstacles.push(...customNeighborBoxes(cn));
      const osm = await fetchOsmBuildings(latitude, longitude, contextRadius);
      for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
      const lm = latLngToWorld(landmarkLat, landmarkLng, latitude, longitude);
      const panels = sampleFacadePanels(volumes, panelSize);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeViewQuality(panels, obstacles, { x: lm.x, y: landmarkY, z: lm.z });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [volumes, latitude, longitude, customNeighbors, hasGeo, landmarkLat, landmarkLng, landmarkY, panelSize, contextRadius]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">View quality on a landmark</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            Line-of-sight from the façade to a chosen landmark (sea, a tower, a park…).
            Returns the share of the façade with clean view to it.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-qube-500 text-white hover:bg-qube-600 disabled:opacity-50 transition-colors"
        >
          {running ? "Running…" : result ? "Re-run" : "Run analysis"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <LatLngField label="Landmark lat" value={landmarkLat} onChange={setLandmarkLat} placeholder="25.260" />
        <LatLngField label="Landmark lng" value={landmarkLng} onChange={setLandmarkLng} placeholder="55.280" />
        <SmallNumField label="Landmark height (m)" value={landmarkY} step={5} min={0} max={400} onChange={setLandmarkY} hint="0 for sea level."/>
        <SmallNumField label="Panel size (m)" value={panelSize} step={1} min={2} max={20} onChange={setPanelSize} />
        <SmallNumField label="OSM radius (m)" value={contextRadius} step={50} min={100} max={2000} onChange={setContextRadius} />
      </div>

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Average view to landmark" value={fmtPct(result.averageViewPct)} good={result.averageViewPct >= 0.3} />
            {result.buckets.map((b) => (
              <Stat key={b.label} label={`Façade with ${b.label} view`} value={fmtPct(b.pct)} sub={`${fmt0(b.areaM2)} m²`} />
            ))}
          </div>

          <div className="border border-ink-200 mb-4">
            <div className="aspect-[16/9] bg-bone-50">
              <PhysicsScene volumes={volumes} panelValues={result.panelValues} scheme="view" />
            </div>
            <ColorRamp scheme="view" leftLabel="No view" rightLabel="Full view" />
          </div>

          <div>
            <div className="eyebrow text-ink-500 mb-2 text-[10.5px]">By orientation</div>
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="text-left py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Orient.</th>
                  <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Area m²</th>
                  <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Avg view</th>
                </tr>
              </thead>
              <tbody>
                {result.byOrientation.map((o) => (
                  <tr key={o.name} className="border-b border-ink-100">
                    <td className="py-1 text-ink-900">{o.name}</td>
                    <td className="py-1 text-right text-ink-700">{fmt0(o.areaM2)}</td>
                    <td className="py-1 text-right text-ink-900">{fmtPct(o.avgPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  PV potential                              */
/* -------------------------------------------------------------------------- */

function PVCard({
  volumes,
  gfa,
}: {
  volumes: ReturnType<typeof buildMassing>["volumes"];
  gfa: number;
}) {
  const [annualGHI, setAnnualGHI] = useState(2150);
  const [efficiency, setEfficiency] = useState(0.21);
  const [pr, setPr] = useState(0.80);
  const [roofUtil, setRoofUtil] = useState(0.55);
  const [includeFacades, setIncludeFacades] = useState(true);
  const [facadeUtil, setFacadeUtil] = useState(0.30);

  const panels = useMemo(() => sampleFacadePanels(volumes, 6), [volumes]);
  const result: PVResult = useMemo(() => {
    return computePVPotential(volumes, panels, {
      annualGHI,
      panelEfficiency: efficiency,
      performanceRatio: pr,
      roofUtilization: roofUtil,
      includeFacades,
      facadeUtilization: facadeUtil,
    });
  }, [volumes, panels, annualGHI, efficiency, pr, roofUtil, includeFacades, facadeUtil]);

  // Indicative residential demand at ~80 kWh/m²/yr × GFA (Dubai cooling-dominated, A-rated).
  const indicativeDemand = gfa * 80;
  const coverage = indicativeDemand > 0 ? result.totalAnnualKWh / indicativeDemand : 0;

  return (
    <div className="card">
      <div>
        <h3 className="text-[15px] font-medium text-ink-900">PV potential</h3>
        <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
          Roof and south-facing façade area × Dubai-default solar yield.
          Live values — change the parameters and the totals update.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        <SmallNumField label="Annual GHI (kWh/m²/yr)" value={annualGHI} step={50} min={500} max={3000} onChange={setAnnualGHI} hint="~2150 for Dubai." />
        <SmallNumField label="Panel efficiency" value={efficiency} step={0.01} min={0.10} max={0.30} onChange={setEfficiency} hint="0.21 = monocrystalline." float />
        <SmallNumField label="Performance ratio" value={pr} step={0.01} min={0.5} max={0.95} onChange={setPr} hint="Inverter, soiling, temp." float />
        <SmallNumField label="Roof utilisation" value={roofUtil} step={0.05} min={0} max={1} onChange={setRoofUtil} hint="After MEP / walkways." float />
        <SmallNumField label="Façade utilisation" value={facadeUtil} step={0.05} min={0} max={1} onChange={setFacadeUtil} hint="After windows / balconies." float />
        <label className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Include façades</span>
          <button
            onClick={() => setIncludeFacades((v) => !v)}
            className={`px-2 py-1 text-[11px] uppercase tracking-[0.10em] border ${includeFacades ? "bg-qube-500 text-white border-qube-500" : "border-ink-300 text-ink-700 bg-white"}`}
          >{includeFacades ? "On" : "Off"}</button>
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Stat label="Roof PV" value={`${fmt2(result.roof.kWp)} kWp`} sub={`${fmt0(result.roof.usableM2)} m² · ${fmt0(result.roof.annualKWh)} kWh/yr`} />
        <Stat label="Façade PV" value={`${fmt2(result.facade.kWp)} kWp`} sub={`${fmt0(result.facade.usableM2)} m² · ${fmt0(result.facade.annualKWh)} kWh/yr`} />
        <Stat label="Total installed" value={`${fmt2(result.totalKWp)} kWp`} sub={`${fmt0(result.totalAnnualKWh)} kWh/yr`} />
        <Stat
          label="Demand cover (indic.)"
          value={fmtPct(coverage)}
          sub={`vs ${fmt0(indicativeDemand)} kWh/yr (≈80 kWh/m² × GFA)`}
          good={coverage >= 0.25}
          bad={coverage > 1}
        />
      </div>

      <div className="border border-ink-200 mt-4">
        <div className="aspect-[16/9] bg-bone-50">
          <PhysicsScene volumes={volumes} panelsForOrientation={panels} scheme="south-arc" />
        </div>
        <div className="flex items-center gap-3 px-3 py-2 border-t border-ink-200 text-[10.5px] text-ink-700">
          <span className="inline-block w-3 h-3" style={{ background: "#e7b14a" }} />
          South arc (PV-eligible)
          <span className="inline-block w-3 h-3 ml-3" style={{ background: "#b6b1a4" }} />
          Other orientations
        </div>
      </div>

      <p className="text-[10.5px] text-ink-500 mt-3 leading-relaxed">
        Indicative — real yield depends on shading, orientation, mounting, and system losses.
        For a final figure, run a PVsyst / SAM simulation.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function Stat({
  label, value, sub, good, bad,
}: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : good ? "text-emerald-700" : "text-ink-900";
  return (
    <div className="border border-ink-200 bg-white p-3">
      <div className="eyebrow text-ink-500 text-[10px]">{label}</div>
      <div className={`text-[20px] font-light tabular-nums mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

function SmallNumField({
  label, value, onChange, step, min, max, hint, float,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  float?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        className="cell-input text-right"
        value={float ? Number(value.toFixed(2)) : value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) {
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
            onChange(clamped);
          }
        }}
      />
      {hint && <span className="text-[10px] text-ink-400 leading-snug">{hint}</span>}
    </label>
  );
}

function LatLngField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      <input
        type="number"
        step={0.0001}
        className="cell-input text-right font-mono text-[11px]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange("");
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) ? n : "");
        }}
      />
    </label>
  );
}

function ColorRamp({
  scheme,
  leftLabel,
  rightLabel,
}: {
  scheme: "viridis" | "view";
  leftLabel: string;
  rightLabel: string;
}) {
  const gradient =
    scheme === "viridis"
      ? "linear-gradient(90deg, #45007e, #3a52a4, #218e8c, #5cb863, #fce824)"
      : "linear-gradient(90deg, #d92f2f, #e8c734, #4ea84e)";
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-ink-200 text-[10.5px] text-ink-700">
      <span className="text-ink-500">{leftLabel}</span>
      <div className="flex-1 h-2.5 border border-ink-200" style={{ background: gradient }} />
      <span className="text-ink-500">{rightLabel}</span>
    </div>
  );
}

function Histogram({ data, unit }: { data: { label: string; value: number }[]; unit?: string }) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  return (
    <div className="grid gap-1">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[80px_1fr_72px] gap-2 items-center text-[11px]">
          <span className="text-ink-500 font-mono">{d.label}</span>
          <div className="h-2 bg-bone-100 border border-ink-100 relative">
            <span
              className="absolute inset-y-0 left-0 bg-qube-400"
              style={{ width: max > 0 ? `${(d.value / max) * 100}%` : "0" }}
            />
          </div>
          <span className="text-right text-ink-700 tabular-nums">{fmt0(d.value)} {unit}</span>
        </div>
      ))}
    </div>
  );
}
