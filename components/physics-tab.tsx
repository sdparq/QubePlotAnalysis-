"use client";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmt2, fmtPct } from "@/lib/format";
import { buildMassing } from "@/lib/massing";
import { offsetPolygon, rectanglePlotPolygon, rectangleToPolygon, type Point } from "@/lib/geom";
import {
  computeAnnualSolar,
  computeMomentShadow,
  computeSkyExposure,
  computeViewQuality,
  customNeighborBoxes,
  dayOfYearFromDate,
  latLngToWorld,
  osmBuildingBox,
  projectBoxes,
  sampleFacadePanels,
  type Box,
  type ShadowResult,
  type SkyExposureResult,
  type SolarResult,
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

      <AnnualSolarCard
        volumes={massing.volumes}
        latitude={project.latitude ?? 0}
        longitude={project.longitude ?? 0}
        customNeighbors={project.customNeighbors ?? []}
        hasGeo={hasGeo}
      />

      <ShadowStudyCard
        volumes={massing.volumes}
        latitude={project.latitude ?? 0}
        longitude={project.longitude ?? 0}
        customNeighbors={project.customNeighbors ?? []}
        hasGeo={hasGeo}
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
/*                              Annual sun exposure                           */
/* -------------------------------------------------------------------------- */

function AnnualSolarCard({
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
  const [days, setDays] = useState(12);
  const [hours, setHours] = useState(12);
  const [contextRadius, setContextRadius] = useState(350);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolarResult | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      if (!hasGeo) throw new Error("Set the project's latitude/longitude in Setup first.");
      const obstacles: Box[] = [...projectBoxes(volumes)];
      for (const cn of customNeighbors) obstacles.push(...customNeighborBoxes(cn));
      const osm = await fetchOsmBuildings(latitude, longitude, contextRadius);
      for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
      const panels = sampleFacadePanels(volumes, panelSize);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeAnnualSolar(panels, obstacles, latitude, { daysPerYear: days, hoursPerDay: hours });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [volumes, latitude, longitude, customNeighbors, hasGeo, panelSize, contextRadius, days, hours]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">Annual sun exposure</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            Hours of direct sunlight per year on each façade panel — sun trajectories sampled
            from the project&apos;s latitude, occluders from neighbours and self-shading. The
            heatmap highlights overheating-prone façades and the best PV locations.
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SmallNumField label="Panel size (m)" value={panelSize} step={1} min={2} max={20} onChange={setPanelSize} hint="Lower = finer, slower." />
        <SmallNumField label="Days / year" value={days} step={4} min={4} max={48} onChange={setDays} hint="12 = monthly." />
        <SmallNumField label="Hours / day" value={hours} step={2} min={4} max={24} onChange={setHours} hint="12 = bi-hourly." />
        <SmallNumField label="OSM radius (m)" value={contextRadius} step={50} min={100} max={1500} onChange={setContextRadius} />
      </div>

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Average sun hours / yr" value={`${fmt0(result.averageSunHours)} h`} good={result.averageSunHours > 1500} />
            <Stat label="Most-exposed panel" value={`${fmt0(result.maxHours)} h`} sub="100% on heatmap" />
            <Stat label="Sun positions sampled" value={`${result.positionsSampled}`} sub={`${days} days × ${hours} h`} />
            <Stat label="Façade evaluated" value={`${fmt0(result.totalAreaM2)} m²`} />
          </div>

          <div className="border border-ink-200 mb-4">
            <div className="aspect-[16/9] bg-bone-50">
              <PhysicsScene volumes={volumes} panelValues={result.panelValues} scheme="solar" />
            </div>
            <ColorRamp scheme="solar" leftLabel="0 h / yr" rightLabel={`${fmt0(result.maxHours)} h / yr`} />
          </div>

          <div>
            <div className="eyebrow text-ink-500 mb-2 text-[10.5px]">By orientation</div>
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="text-left py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Orient.</th>
                  <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Area m²</th>
                  <th className="text-right py-1 font-medium text-ink-500 text-[10.5px] uppercase tracking-[0.10em]">Avg h/yr</th>
                </tr>
              </thead>
              <tbody>
                {result.byOrientation.map((o) => (
                  <tr key={o.name} className="border-b border-ink-100">
                    <td className="py-1 text-ink-900">{o.name}</td>
                    <td className="py-1 text-right text-ink-700">{fmt0(o.areaM2)}</td>
                    <td className="py-1 text-right text-ink-900">{fmt0(o.avgHours)}</td>
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
/*                                Shadow study                                */
/* -------------------------------------------------------------------------- */

function ShadowStudyCard({
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
  const today = new Date();
  const [dateStr, setDateStr] = useState(`${today.getFullYear()}-06-21`); // summer solstice default
  const [hour, setHour] = useState(12);
  const [panelSize, setPanelSize] = useState(6);
  const [contextRadius, setContextRadius] = useState(350);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShadowResult | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      if (!hasGeo) throw new Error("Set the project's latitude/longitude in Setup first.");
      const obstacles: Box[] = [...projectBoxes(volumes)];
      for (const cn of customNeighbors) obstacles.push(...customNeighborBoxes(cn));
      const osm = await fetchOsmBuildings(latitude, longitude, contextRadius);
      for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
      const panels = sampleFacadePanels(volumes, panelSize);
      const date = new Date(`${dateStr}T00:00:00`);
      const dayOfYear = dayOfYearFromDate(date);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeMomentShadow(panels, obstacles, latitude, dayOfYear, hour);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [volumes, latitude, longitude, customNeighbors, hasGeo, dateStr, hour, panelSize, contextRadius]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">Shadow study · point in time</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            Pick a date and a solar hour and the heatmap shows which façade panels are
            sunlit (yellow) vs shaded (navy) at that exact moment, considering all
            neighbours and the building&apos;s own self-shading.
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
        <label className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Date</span>
          <input
            type="date"
            className="cell-input"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Solar hour</span>
          <input
            type="range"
            min={4}
            max={20}
            step={0.5}
            value={hour}
            onChange={(e) => setHour(parseFloat(e.target.value))}
            className="w-full accent-qube-500"
          />
          <span className="text-[11px] text-ink-700 tabular-nums">
            {Math.floor(hour).toString().padStart(2, "0")}:{Math.round((hour % 1) * 60).toString().padStart(2, "0")}
          </span>
        </label>
        <SmallNumField label="Panel size (m)" value={panelSize} step={1} min={2} max={20} onChange={setPanelSize} />
        <SmallNumField label="OSM radius (m)" value={contextRadius} step={50} min={100} max={1500} onChange={setContextRadius} />
        <div className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Quick presets</span>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "Jun 21", date: "06-21" },
              { label: "Dec 21", date: "12-21" },
              { label: "Mar 21", date: "03-21" },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setDateStr(`${today.getFullYear()}-${p.date}`)}
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] border border-ink-300 text-ink-700 bg-white hover:bg-bone-50"
              >{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat
              label="Façade in direct sun"
              value={result.sun ? fmtPct(result.litAreaPct) : "—"}
              good={result.litAreaPct > 0.4}
              sub={result.sun ? undefined : "Sun below horizon"}
            />
            <Stat label="Sun elevation" value={result.sun ? `${result.sunElevationDeg.toFixed(1)}°` : "—"} />
            <Stat label="Sun azimuth" value={result.sun ? `${result.sunAzimuthDeg.toFixed(0)}°` : "—"} sub="Clockwise from N" />
            <Stat label="Façade evaluated" value={`${fmt0(result.totalAreaM2)} m²`} />
          </div>

          <div className="border border-ink-200">
            <div className="aspect-[16/9] bg-bone-50">
              <PhysicsScene volumes={volumes} panelValues={result.panelValues} scheme="shadow" />
            </div>
            <div className="flex items-center gap-3 px-3 py-2 border-t border-ink-200 text-[10.5px] text-ink-700">
              <span className="inline-block w-3 h-3" style={{ background: "#f2c14e" }} />
              Sunlit
              <span className="inline-block w-3 h-3 ml-3" style={{ background: "#2c3e6b" }} />
              Shaded
            </div>
          </div>
        </>
      )}
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
  scheme: "viridis" | "view" | "solar";
  leftLabel: string;
  rightLabel: string;
}) {
  const gradient =
    scheme === "viridis"
      ? "linear-gradient(90deg, #45007e, #3a52a4, #218e8c, #5cb863, #fce824)"
      : scheme === "solar"
        ? "linear-gradient(90deg, #0d1052, #672980, #c94466, #f48c33, #fdee8c)"
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
