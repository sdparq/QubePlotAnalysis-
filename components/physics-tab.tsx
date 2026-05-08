"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useProject } from "@/lib/store";
import { computeProgram } from "@/lib/calc/program";
import { fmt0, fmtPct } from "@/lib/format";
import { buildMassing } from "@/lib/massing";
import { offsetPolygon, rectanglePlotPolygon, rectangleToPolygon, type Point } from "@/lib/geom";
import {
  computeAnnualSolar,
  computeMomentShadow,
  computeViewQuality,
  customNeighborBoxes,
  dayOfYearFromDate,
  latLngToWorld,
  osmBuildingBox,
  projectBoxes,
  sampleFacadePanels,
  type Box,
  type ShadowResult,
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

// Sensible defaults — not user-editable. Keep the UI simple.
const PANEL_SIZE_M = 6;
const CONTEXT_RADIUS_M = 400;
const SUN_DAYS = 12;
const SUN_HOURS = 12;

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
        <h2 className="section-title">Sun & views</h2>
        <p className="section-sub">
          See directly on the volume <strong>how much sun</strong> each façade gets and
          <strong> what can be seen</strong> from it. The building is painted with a colour
          map so you can spot the best and worst areas at a glance.
        </p>
      </div>

      {!hasGeo && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-[12.5px] text-amber-900 leading-snug">
            These analyses need the project&apos;s <strong>latitude and longitude</strong>.
            Set them in the <em>Setup</em> tab and come back.
          </p>
        </div>
      )}

      <SunCard
        volumes={massing.volumes}
        latitude={project.latitude ?? 0}
        longitude={project.longitude ?? 0}
        customNeighbors={project.customNeighbors ?? []}
        hasGeo={hasGeo}
      />

      <ViewsCard
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
/*                               Sun & shadows                                */
/* -------------------------------------------------------------------------- */

type SunMode = "annual" | "moment";

function SunCard({
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
  const [mode, setMode] = useState<SunMode>("annual");
  const today = new Date();
  const [dateStr, setDateStr] = useState(`${today.getFullYear()}-06-21`);
  const [hour, setHour] = useState(12);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annualResult, setAnnualResult] = useState<SolarResult | null>(null);
  const [shadowResult, setShadowResult] = useState<ShadowResult | null>(null);

  const buildObstacles = useCallback(async (): Promise<Box[]> => {
    const obstacles: Box[] = [...projectBoxes(volumes)];
    for (const cn of customNeighbors) obstacles.push(...customNeighborBoxes(cn));
    if (hasGeo) {
      const osm = await fetchOsmBuildings(latitude, longitude, CONTEXT_RADIUS_M);
      for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
    }
    return obstacles;
  }, [volumes, customNeighbors, hasGeo, latitude, longitude]);

  const runAnnual = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      if (!hasGeo) throw new Error("Set the project's latitude/longitude in Setup first.");
      const obstacles = await buildObstacles();
      const panels = sampleFacadePanels(volumes, PANEL_SIZE_M);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeAnnualSolar(panels, obstacles, latitude, {
        daysPerYear: SUN_DAYS,
        hoursPerDay: SUN_HOURS,
      });
      setAnnualResult(r);
      setShadowResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [hasGeo, buildObstacles, volumes, latitude]);

  const runMoment = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      if (!hasGeo) throw new Error("Set the project's latitude/longitude in Setup first.");
      const obstacles = await buildObstacles();
      const panels = sampleFacadePanels(volumes, PANEL_SIZE_M);
      const date = new Date(`${dateStr}T00:00:00`);
      const dayOfYear = dayOfYearFromDate(date);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeMomentShadow(panels, obstacles, latitude, dayOfYear, hour);
      setShadowResult(r);
      setAnnualResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [hasGeo, buildObstacles, volumes, latitude, dateStr, hour]);

  const handleRun = mode === "annual" ? runAnnual : runMoment;
  const result = mode === "annual" ? annualResult : shadowResult;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">☀ Sun &amp; shadows</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            {mode === "annual"
              ? "How much sunlight each façade gets over the year. Yellow areas catch a lot of sun; blue ones much less."
              : "Where the shadow falls at a specific date and time. Yellow = sunlit; navy = in shadow."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex border border-ink-200 bg-bone-50">
            <button
              onClick={() => setMode("annual")}
              className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "annual" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >
              Over the year
            </button>
            <button
              onClick={() => setMode("moment")}
              className={`px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.10em] transition-colors ${
                mode === "moment" ? "bg-qube-500 text-white" : "text-ink-700 hover:bg-bone-200"
              }`}
            >
              At a moment
            </button>
          </div>
          <button
            onClick={handleRun}
            disabled={running}
            className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-ink-900 text-bone-100 hover:bg-ink-700 disabled:opacity-50 transition-colors"
          >
            {running ? "Computing…" : result ? "Re-run" : "Run"}
          </button>
        </div>
      </div>

      {mode === "moment" && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end mb-4">
          <label className="grid gap-1">
            <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Date &amp; time</span>
            <div className="flex items-center gap-3">
              <input
                type="date"
                className="cell-input"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <input
                type="range"
                min={5}
                max={20}
                step={0.5}
                value={hour}
                onChange={(e) => setHour(parseFloat(e.target.value))}
                className="flex-1 accent-qube-500"
              />
              <span className="text-[12px] text-ink-700 tabular-nums w-[52px] text-right">
                {Math.floor(hour).toString().padStart(2, "0")}:
                {Math.round((hour % 1) * 60).toString().padStart(2, "0")}
              </span>
            </div>
          </label>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "Summer solstice", date: "06-21" },
              { label: "Winter solstice", date: "12-21" },
              { label: "Equinox", date: "03-21" },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setDateStr(`${today.getFullYear()}-${p.date}`)}
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.10em] border border-ink-300 text-ink-700 bg-white hover:bg-bone-50"
              >{p.label}</button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      <div className="border border-ink-200">
        <div className="aspect-[16/9] bg-bone-50">
          {result ? (
            <PhysicsScene
              volumes={volumes}
              panelValues={result.panelValues}
              scheme={mode === "annual" ? "solar" : "shadow"}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-ink-500">
              {running ? "Computing…" : "Click Run to paint the volume with the colour map."}
            </div>
          )}
        </div>
        {mode === "annual" && annualResult && (
          <ColorRamp
            scheme="solar"
            leftLabel="Low sun"
            rightLabel={`${fmt0(annualResult.maxHours)} h/year`}
          />
        )}
        {mode === "moment" && shadowResult && (
          <div className="flex items-center gap-3 px-3 py-2 border-t border-ink-200 text-[10.5px] text-ink-700">
            <span className="inline-block w-3 h-3" style={{ background: "#f2c14e" }} />
            Sunlit
            <span className="inline-block w-3 h-3 ml-3" style={{ background: "#2c3e6b" }} />
            In shadow
          </div>
        )}
      </div>

      {mode === "annual" && annualResult && (
        <p className="text-[12px] text-ink-700 mt-3">
          On average, each square metre of façade gets <strong>{fmt0(annualResult.averageSunHours)} hours of direct sun per year</strong>.
          The most exposed area reaches {fmt0(annualResult.maxHours)} h/year.
        </p>
      )}
      {mode === "moment" && shadowResult && (
        <p className="text-[12px] text-ink-700 mt-3">
          {shadowResult.sun ? (
            <>
              At that moment <strong>{fmtPct(shadowResult.litAreaPct)} of the façade</strong> is in direct sun.
              Sun elevation {shadowResult.sunElevationDeg.toFixed(0)}°, azimuth {shadowResult.sunAzimuthDeg.toFixed(0)}°.
            </>
          ) : (
            <>The sun is below the horizon at that time — the whole façade is in shadow.</>
          )}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Views                                    */
/* -------------------------------------------------------------------------- */

function ViewsCard({
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
      const osm = await fetchOsmBuildings(latitude, longitude, Math.max(CONTEXT_RADIUS_M, 700));
      for (const b of osm) obstacles.push(osmBuildingBox(b.polygon, b.defaultHeight));
      const lm = latLngToWorld(landmarkLat, landmarkLng, latitude, longitude);
      const panels = sampleFacadePanels(volumes, PANEL_SIZE_M);
      await new Promise((r) => setTimeout(r, 0));
      const r = computeViewQuality(panels, obstacles, { x: lm.x, y: landmarkY, z: lm.z });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [volumes, latitude, longitude, customNeighbors, hasGeo, landmarkLat, landmarkLng, landmarkY]);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-[15px] font-medium text-ink-900">👁 Views from the façade</h3>
          <p className="text-[12px] text-ink-500 leading-snug max-w-xl mt-1">
            Pick a point of interest (the coast, a park, a landmark) by its coordinates and
            the colour map shows which parts of the façade see it unobstructed. Green = clear
            view. Red = blocked by another building.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.10em] bg-ink-900 text-bone-100 hover:bg-ink-700 disabled:opacity-50 transition-colors"
        >
          {running ? "Computing…" : result ? "Re-run" : "Run"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <LatLngField label="Landmark latitude" value={landmarkLat} onChange={setLandmarkLat} placeholder="25.260" />
        <LatLngField label="Landmark longitude" value={landmarkLng} onChange={setLandmarkLng} placeholder="55.280" />
        <label className="grid gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">Landmark height (m)</span>
          <input
            type="number"
            step={5}
            min={0}
            className="cell-input text-right"
            value={landmarkY}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n) && n >= 0) setLandmarkY(n);
            }}
          />
        </label>
      </div>

      {error && <div className="text-[12px] text-red-700 mb-3">{error}</div>}

      <div className="border border-ink-200">
        <div className="aspect-[16/9] bg-bone-50">
          {result ? (
            <PhysicsScene volumes={volumes} panelValues={result.panelValues} scheme="view" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-ink-500">
              {running ? "Computing…" : "Enter the coordinates and click Run."}
            </div>
          )}
        </div>
        {result && (
          <ColorRamp scheme="view" leftLabel="No view" rightLabel="Clear view" />
        )}
      </div>

      {result && (
        <p className="text-[12px] text-ink-700 mt-3">
          On average, <strong>{fmtPct(result.averageViewPct)} of the façade</strong> sees the landmark.
          {" "}
          {result.buckets[3] && result.buckets[3].pct > 0 && (
            <>{fmtPct(result.buckets[3].pct)} enjoys a wide-open view (&gt;50%).</>
          )}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function ColorRamp({
  scheme,
  leftLabel,
  rightLabel,
}: {
  scheme: "view" | "solar";
  leftLabel: string;
  rightLabel: string;
}) {
  const gradient =
    scheme === "solar"
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

function LatLngField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  placeholder?: string;
}) {
  // Internal text state — lets the user type "25.", "25.2", "25,260" freely
  // without React snapping the value back as the number is being typed.
  const [text, setText] = useState<string>(typeof value === "number" ? String(value) : "");
  // Re-sync text if the parent resets the value (e.g. via a "clear" button).
  useEffect(() => {
    const fromParent = typeof value === "number" ? String(value) : "";
    const parsedLocal = parseFloat(text.replace(",", "."));
    if (value !== parsedLocal && fromParent !== text) setText(fromParent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.10em] text-ink-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        className="cell-input text-right font-mono text-[11px]"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") return onChange("");
          const n = parseFloat(raw.replace(",", "."));
          onChange(Number.isFinite(n) ? n : "");
        }}
      />
    </label>
  );
}
