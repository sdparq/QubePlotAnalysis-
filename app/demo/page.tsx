"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTION_CITY_SAMPLE } from "@/lib/sample";
import { computeProgram } from "@/lib/calc/program";
import { computeParking } from "@/lib/calc/parking";
import { computeLifts } from "@/lib/calc/lifts";
import { useStore } from "@/lib/store";
import { fmt0, fmt2, fmtPct } from "@/lib/format";

/**
 * Scripted promo of the Qube Plot Analysis app, using the real Production City
 * sample as the example. All KPIs in the scenes are computed from the sample —
 * not invented — so the demo matches what you see when you run the app.
 *
 * Auto-advances scene by scene. Record the page with a screen capture tool
 * (QuickTime, Loom, OBS, OS shortcut) to produce a video.
 */

type Render = (p: { t: number; data: SampleData }) => React.ReactNode;
interface Scene {
  id: string;
  durationMs: number;
  caption: string;
  render: Render;
}

interface SampleData {
  project: typeof PRODUCTION_CITY_SAMPLE;
  program: ReturnType<typeof computeProgram>;
  parking: ReturnType<typeof computeParking>;
  lifts: ReturnType<typeof computeLifts>;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/* -------------------------------------------------------------------------- */
/*                                   Scenes                                   */
/* -------------------------------------------------------------------------- */

function HeroScene({ t, data }: { t: number; data: SampleData }) {
  const opacity = ease(t * 1.5);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-bone-100 to-bone-200">
      <div className="absolute inset-0 opacity-[0.05]" style={{
        backgroundImage: "linear-gradient(0deg, transparent 95%, #647d57 95%), linear-gradient(90deg, transparent 95%, #647d57 95%)",
        backgroundSize: "40px 40px",
      }} />
      <div className="text-center relative z-10" style={{ opacity, transform: `translateY(${(1 - opacity) * 12}px)` }}>
        <div className="eyebrow text-qube-700 mb-4" style={{ letterSpacing: "0.4em" }}>
          QUBE Development · Internal tool
        </div>
        <h1 className="text-6xl md:text-7xl font-light text-ink-900 tracking-tight mb-3">
          Plot Analysis
        </h1>
        <p className="text-lg text-ink-500 max-w-xl mx-auto leading-relaxed mb-6">
          A residential plot, fully analysed in minutes.
        </p>
        <div className="text-[11px] uppercase tracking-[0.30em] text-ink-400">
          Live example · {data.project.name}
        </div>
      </div>
    </div>
  );
}

function SetupScene({ t, data }: { t: number; data: SampleData }) {
  const p = data.project;
  const lines = [
    { k: "Project", v: p.name },
    { k: "Zone", v: p.zone },
    { k: "Plot area", v: `${fmt2(p.plotArea)} m²` },
    { k: "Frontage × Depth", v: `${fmt2(p.plotFrontage ?? 0)} × ${fmt2(p.plotDepth ?? 0)} m` },
    { k: "Floors", v: `${p.numFloors}` },
    { k: "Floor height", v: `${p.floorHeight.toFixed(2)} m` },
    { k: "Setbacks (F / R / S)", v: `${p.setbackFront} / ${p.setbackRear} / ${p.setbackSide} m` },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[600px]">
        <div className="eyebrow text-ink-500">Tab 01 · Setup</div>
        <div className="border border-ink-200 bg-white shadow-sm divide-y divide-ink-100">
          {lines.map((l, i) => {
            const start = 0.05 + i * 0.10;
            const local = clamp01((t - start) / 0.18);
            const reveal = Math.floor(local * l.v.length);
            return (
              <div key={l.k} className="grid grid-cols-[200px_1fr] px-4 py-2.5 items-baseline">
                <span className="text-[11px] uppercase tracking-[0.10em] text-ink-500">{l.k}</span>
                <span className="text-[14px] text-ink-900 tabular-nums font-light">
                  {l.v.slice(0, reveal)}
                  {reveal > 0 && reveal < l.v.length && <span className="opacity-60">▍</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlotScene({ t }: { t: number }) {
  // Real Production City plot is 80 × 84.55 m (rectangle); show it on a faux blueprint.
  const verts: [number, number][] = [
    [110, 80], [510, 80], [510, 320], [110, 320],
  ];
  const total = verts.length;
  const shown = Math.min(total, Math.floor(ease(t * 1.4) * (total + 1)));
  const closed = ease(t * 1.4) >= 1;
  let d = "";
  for (let i = 0; i < shown; i++) d += (i === 0 ? "M" : "L") + verts[i].join(",");
  if (closed) d += " Z";

  const sb = ease(clamp01((t - 0.55) / 0.4));
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3" style={{ opacity: ease(Math.min(1, t * 5)) }}>
        <div className="flex items-baseline gap-3">
          <span className="eyebrow text-ink-500">Tab 00 · Plot</span>
          <span className="text-[11px] text-ink-400">Production City · IMPZ</span>
        </div>
        <svg width="640" height="400" viewBox="0 0 640 400" className="border border-ink-200 bg-white shadow-sm">
          <defs>
            <pattern id="diag" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
              <rect width="14" height="14" fill="#fbf9f3" />
              <line x1="0" y1="0" x2="0" y2="14" stroke="#eee9d8" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="640" height="400" fill="url(#diag)" />
          <path d={d} fill={closed ? "rgba(100,125,87,0.16)" : "none"} stroke="#647d57" strokeWidth="2.4" strokeLinejoin="round" />
          {verts.slice(0, shown).map((p, i) => (
            <circle key={i} cx={p[0]} cy={p[1]} r={4.5} fill="#fff" stroke="#647d57" strokeWidth="2" />
          ))}
          {/* Buildable polygon (after setbacks) */}
          {closed && (
            <rect
              x={110 + 24}
              y={80 + 14}
              width={400 - 24 - 14}
              height={240 - 14 - 14}
              fill="rgba(155,180,135,0.22)"
              stroke="#7a9468"
              strokeDasharray="4 3"
              strokeWidth="1.5"
              style={{ opacity: sb }}
            />
          )}
          {closed && (
            <g style={{ opacity: ease(clamp01((t - 0.7) / 0.3)) }}>
              <text x="310" y="208" textAnchor="middle" fill="#33422e" fontSize="15" fontFamily="ui-monospace, monospace">6,764.31 m²</text>
              <text x="310" y="226" textAnchor="middle" fill="#647d57" fontSize="11" fontFamily="ui-monospace, monospace">80 × 84.55 m · setbacks 6 / 3 / 3</text>
            </g>
          )}
        </svg>
        <p className="text-[12px] text-ink-500 max-w-[640px] leading-relaxed">
          Trace the parcel from a PDF or aerial drawing, set a 2-point scale,
          and the buildable area is offset automatically per edge.
        </p>
      </div>
    </div>
  );
}

function TypologiesScene({ t, data }: { t: number; data: SampleData }) {
  const rows = data.project.typologies;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[760px]">
        <div className="eyebrow text-ink-500">Tab 02 · Typologies</div>
        <div className="border border-ink-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_70px_90px_90px_90px_90px] px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <div>Name</div>
            <div className="text-right">Cat.</div>
            <div className="text-right">Interior</div>
            <div className="text-right">Balcony</div>
            <div className="text-right">Occ.</div>
            <div className="text-right">Pkg / unit</div>
          </div>
          {rows.map((r, i) => {
            const local = ease(clamp01((t - i * 0.075) / 0.18));
            return (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_70px_90px_90px_90px_90px] px-3 py-1.5 text-[12px] tabular-nums border-b border-ink-100 last:border-b-0"
                style={{ opacity: local, transform: `translateY(${(1 - local) * 6}px)` }}
              >
                <div className="text-ink-900">{r.name}</div>
                <div className="text-right text-ink-500">{r.category}</div>
                <div className="text-right text-ink-700">{r.internalArea} m²</div>
                <div className="text-right text-ink-500">{r.balconyArea} m²</div>
                <div className="text-right text-ink-500">{r.occupancy}</div>
                <div className="text-right text-ink-700">{r.parkingPerUnit}</div>
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-ink-500">
          {rows.length} unit types · Studio + 1BR (4) + 2BR (4) + 3BR (1) — fully editable per project.
        </p>
      </div>
    </div>
  );
}

function ProgramScene({ t, data }: { t: number; data: SampleData }) {
  const ts = data.project.typologies;
  const tIds = ts.map((x) => x.id);
  const numFloors = data.project.numFloors;
  const cellsByFloorTypology = new Map<string, number>();
  for (const c of data.project.program) {
    cellsByFloorTypology.set(`${c.floor}-${c.typologyId}`, c.count);
  }

  // Reveal cells row-by-row top to bottom (from floor 8 down to 1).
  const totalCells = numFloors * tIds.length;
  const revealed = Math.floor(ease(t * 1.05) * totalCells);
  const totalsByT = tIds.map((tid, ti) => {
    let s = 0;
    for (let fi = 0; fi < numFloors; fi++) {
      const cellIdx = fi * tIds.length + ti;
      if (cellIdx < revealed) s += cellsByFloorTypology.get(`${numFloors - fi}-${tid}`) ?? 0;
    }
    return s;
  });
  const grandTotal = totalsByT.reduce((a, b) => a + b, 0);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3">
        <div className="eyebrow text-ink-500">Tab 03 · Program</div>
        <div className="border border-ink-200 bg-white shadow-sm">
          <div
            className="grid text-[10.5px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200"
            style={{ gridTemplateColumns: `52px repeat(${tIds.length}, 56px) 60px` }}
          >
            <div className="px-2 py-1.5">Fl</div>
            {ts.map((typo) => (
              <div key={typo.id} className="px-1 py-1.5 text-center" title={typo.name}>
                {typo.name.replace("Type ", "").replace("Studio ", "ST ")}
              </div>
            ))}
            <div className="px-2 py-1.5 text-right">Total</div>
          </div>
          {Array.from({ length: numFloors }).map((_, fi) => {
            const floor = numFloors - fi;
            const rowTotal = ts.reduce((s, typo, ti) => {
              const cellIdx = fi * tIds.length + ti;
              if (cellIdx >= revealed) return s;
              return s + (cellsByFloorTypology.get(`${floor}-${typo.id}`) ?? 0);
            }, 0);
            return (
              <div
                key={fi}
                className="grid text-[12px] tabular-nums border-b border-ink-100 last:border-b-0"
                style={{ gridTemplateColumns: `52px repeat(${tIds.length}, 56px) 60px` }}
              >
                <div className="px-2 py-1 text-ink-500">{floor}</div>
                {ts.map((typo, ti) => {
                  const cellIdx = fi * tIds.length + ti;
                  const v = cellsByFloorTypology.get(`${floor}-${typo.id}`) ?? 0;
                  const visible = cellIdx < revealed;
                  return (
                    <div
                      key={typo.id}
                      className="px-1 py-1 text-center"
                      style={{
                        opacity: visible ? 1 : 0,
                        background: visible && v > 0 ? "#f0f4ec" : "transparent",
                        color: v === 0 ? "#9ca09b" : "#33422e",
                        transition: "opacity 200ms",
                      }}
                    >
                      {v || "·"}
                    </div>
                  );
                })}
                <div className="px-2 py-1 text-right text-ink-700 font-medium">{rowTotal || "·"}</div>
              </div>
            );
          })}
          <div
            className="grid text-[12px] tabular-nums bg-qube-50 font-medium"
            style={{ gridTemplateColumns: `52px repeat(${tIds.length}, 56px) 60px` }}
          >
            <div className="px-2 py-1.5 text-qube-800 uppercase text-[10.5px] tracking-[0.10em]">Σ</div>
            {totalsByT.map((tt, i) => (
              <div key={i} className="px-1 py-1.5 text-center text-qube-800">{tt}</div>
            ))}
            <div className="px-2 py-1.5 text-right text-qube-800">{grandTotal}</div>
          </div>
        </div>
        <p className="text-[12px] text-ink-500">
          {data.program.totalUnits} units across {numFloors} floors · {fmt2(data.program.totalInteriorGFA)} m² interior GFA.
        </p>
      </div>
    </div>
  );
}

function CommonAreasScene({ t, data }: { t: number; data: SampleData }) {
  const sample = data.project.commonAreas.slice(0, 12);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[760px]">
        <div className="eyebrow text-ink-500">Tab 04 · Common areas</div>
        <div className="border border-ink-200 bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_60px_70px_90px] px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <div>Name</div>
            <div className="text-center">Floors</div>
            <div className="text-right">Area / fl</div>
            <div className="text-right">Counts as</div>
          </div>
          {sample.map((c, i) => {
            const local = ease(clamp01((t - i * 0.06) / 0.16));
            const cat = c.countAsGFA === false ? "OPEN" : "GFA";
            return (
              <div
                key={c.id}
                className="grid grid-cols-[1fr_60px_70px_90px] px-3 py-1 text-[12px] tabular-nums border-b border-ink-100 last:border-b-0"
                style={{ opacity: local, transform: `translateX(${(1 - local) * -10}px)` }}
              >
                <div className="text-ink-900 truncate">{c.name}</div>
                <div className="text-center text-ink-500">{c.floors}</div>
                <div className="text-right text-ink-700">{c.area} m²</div>
                <div className="text-right">
                  <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] ${cat === "GFA" ? "bg-qube-100 text-qube-800" : "bg-bone-200 text-ink-700"}`}>
                    {cat}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="grid grid-cols-[1fr_60px_70px_90px] px-3 py-1.5 text-[12px] tabular-nums bg-qube-50 font-medium">
            <div className="text-qube-800 uppercase text-[10.5px] tracking-[0.10em]">Total</div>
            <div></div>
            <div className="text-right text-qube-800">{fmt0(data.program.commonAreasGFA + data.program.commonAreasBUAonly + data.program.commonAreasOpen)} m²</div>
            <div className="text-right text-qube-800 text-[10.5px]">22 rows</div>
          </div>
        </div>
        <p className="text-[12px] text-ink-500">
          Lobbies, corridors, lifts, MEP, gym, pools, BBQ, yoga, club house — each counted as <strong>GFA</strong>, <strong>BUA-only</strong> or <strong>OPEN</strong>.
        </p>
      </div>
    </div>
  );
}

function MassingScene({ t, data }: { t: number; data: SampleData }) {
  const floors = data.project.numFloors;
  const visible = Math.min(floors, Math.floor(ease(t * 1.5) * floors) + 1);
  const yaw = -30 + ease(Math.max(0, (t - 0.4) / 0.6)) * 30;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-100 overflow-hidden">
      <div className="absolute inset-0" style={{
        background: "radial-gradient(circle at 50% 30%, #f3efe2 0%, #d9d4c0 100%)",
      }} />
      <div
        className="relative"
        style={{
          width: 320,
          height: 320,
          transformStyle: "preserve-3d",
          transform: `perspective(1400px) rotateX(58deg) rotateZ(${yaw}deg)`,
          transition: "transform 60ms linear",
        }}
      >
        <div className="absolute inset-0 border border-ink-300/70 bg-bone-50/40" />
        {Array.from({ length: visible }).map((_, i) => {
          const sizeBase = 220;
          const w = sizeBase - Math.max(0, i - 6) * 18;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: "50%",
                top: "50%",
                width: w,
                height: w * 0.86,
                transform: `translate3d(-50%, -50%, ${i * 18}px)`,
                background: "#647d57",
                border: "1px solid #33422e",
                opacity: 0.96,
                boxShadow: i === visible - 1 ? "0 4px 18px rgba(0,0,0,0.18)" : "none",
              }}
            />
          );
        })}
      </div>
      <div className="absolute top-6 left-6 grid gap-1 text-ink-700">
        <div className="eyebrow text-ink-500">Tab 08 · Massing 3D</div>
        <div className="text-[15px] font-medium">{visible} floors · {(visible * data.project.floorHeight).toFixed(1)} m</div>
        <div className="text-[11px] text-ink-500 tabular-nums">Floor area ≈ {fmt0(data.program.totalGFABuilding / data.project.numFloors)} m² · FAR {data.program.far.toFixed(2)}</div>
      </div>
      <div className="absolute bottom-6 left-6 right-6 flex items-center gap-2 flex-wrap">
        {(["Block", "Podium", "Courtyard", "Twin", "Stepped", "L-shape", "U-shape"] as const).map((s, i) => (
          <div
            key={s}
            className={`px-2 py-1 text-[10.5px] uppercase tracking-[0.10em] border ${i === 0 ? "bg-qube-500 text-white border-qube-500" : "border-ink-300 text-ink-700 bg-white"}`}
            style={{ opacity: ease(Math.min(1, (t - 0.55 - i * 0.04) * 6)) }}
          >{s}</div>
        ))}
      </div>
    </div>
  );
}

function ContextScene({ t }: { t: number }) {
  const neighbors: { x: number; y: number; w: number; h: number; tower?: number }[] = [
    { x: 60, y: 60, w: 120, h: 90 },
    { x: 220, y: 50, w: 110, h: 70, tower: 60 },
    { x: 360, y: 60, w: 130, h: 110, tower: 80 },
    { x: 520, y: 70, w: 90, h: 100 },
    { x: 70, y: 200, w: 110, h: 110, tower: 50 },
    { x: 360, y: 220, w: 130, h: 90 },
    { x: 530, y: 210, w: 90, h: 100 },
    { x: 70, y: 350, w: 130, h: 80 },
    { x: 230, y: 360, w: 110, h: 70 },
    { x: 380, y: 360, w: 130, h: 90 },
    { x: 540, y: 360, w: 90, h: 80 },
  ];
  const heroOpacity = ease(Math.max(0, (t - 0.55) / 0.4));
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{
      background: "linear-gradient(180deg, #b9c8d3 0%, #d6dde1 100%)",
    }}>
      <div className="relative" style={{
        width: 700, height: 460,
        transformStyle: "preserve-3d",
        transform: "perspective(1400px) rotateX(56deg) rotateZ(-22deg)",
      }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #d8d7cb 0%, #c4c2b3 100%)" }} />
        <div className="absolute" style={{ left: 0, top: 175, width: "100%", height: 14, background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 0, top: 325, width: "100%", height: 12, background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 195, top: 0, width: 14, height: "100%", background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 510, top: 0, width: 14, height: "100%", background: "#aaa9a0" }} />
        {neighbors.map((n, i) => {
          const localStart = 0.04 + i * 0.04;
          const local = ease(clamp01((t - localStart) / 0.25));
          return (
            <div key={i} style={{ position: "absolute", left: n.x, top: n.y, width: n.w, height: n.h, opacity: local }}>
              <div className="absolute inset-0" style={{ background: "#f3f1ec", border: "1px solid #aeada6", transform: `translateZ(${24 * local}px)` }} />
              {n.tower && (
                <div style={{ position: "absolute", left: "20%", top: "20%", width: "60%", height: "60%", background: "#e9e6dc", border: "1px solid #aeada6", transform: `translateZ(${(24 + n.tower) * local}px)` }} />
              )}
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 270, top: 185, width: 170, height: 130, opacity: heroOpacity }}>
          <div className="absolute inset-0" style={{ background: "#647d57", border: "1px solid #33422e", transform: "translateZ(40px)", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }} />
          <div style={{ position: "absolute", left: "22%", top: "22%", width: "56%", height: "56%", background: "#7a9468", border: "1px solid #33422e", transform: "translateZ(160px)", boxShadow: "0 12px 30px rgba(0,0,0,0.25)" }} />
        </div>
      </div>
      <div className="absolute top-6 left-6 grid gap-1 text-ink-900">
        <div className="eyebrow text-ink-500">Tab 08 · In-context</div>
        <div className="text-[15px] font-medium">Drop the building on its real plot</div>
        <div className="text-[11px] text-ink-500">Neighbours from OpenStreetMap · click to edit heights</div>
      </div>
    </div>
  );
}

function AiRenderScene({ t }: { t: number }) {
  const phase = t < 0.45 ? "input" : t < 0.7 ? "rendering" : "output";
  return (
    <div className="absolute inset-0 grid grid-cols-2 gap-4 p-10 bg-bone-50">
      <div className="border border-ink-200 bg-white shadow-sm relative overflow-hidden">
        <div className="absolute top-2 left-2 eyebrow text-ink-500 text-[10px]">Input · 3D viewer</div>
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(circle at 50% 30%, #f3efe2 0%, #d9d4c0 100%)" }}>
          <div className="relative" style={{ width: 220, height: 220, transformStyle: "preserve-3d", transform: "perspective(1100px) rotateX(58deg) rotateZ(-30deg)" }}>
            {Array.from({ length: 8 }).map((_, i) => {
              const w = 150 - Math.max(0, i - 5) * 14;
              return (
                <div key={i} className="absolute" style={{
                  left: "50%", top: "50%", width: w, height: w * 0.86,
                  transform: `translate3d(-50%, -50%, ${i * 14}px)`,
                  background: i < 1 ? "#8a9a76" : "#647d57",
                  border: "1px solid #33422e",
                }} />
              );
            })}
          </div>
        </div>
      </div>
      <div className="border border-ink-200 bg-white shadow-sm relative overflow-hidden">
        <div className="absolute top-2 left-2 eyebrow text-ink-500 text-[10px]">Output · Gemini scheme</div>
        {phase === "input" && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-[12px] italic">Click ✦ Render scheme</div>
        )}
        {phase === "rendering" && (
          <div className="absolute inset-0 flex items-center justify-center grid gap-3 justify-items-center">
            <div className="w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-[12px] text-ink-700">Rendering with Gemini…</div>
          </div>
        )}
        {phase === "output" && (
          <svg viewBox="0 0 400 320" className="w-full h-full" style={{ opacity: ease((t - 0.7) / 0.3) }}>
            <defs>
              <linearGradient id="sky2" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#cfe1ec" /><stop offset="100%" stopColor="#f1ede0" />
              </linearGradient>
              <linearGradient id="ground2" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e8e0c8" /><stop offset="100%" stopColor="#d5cca9" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="400" height="200" fill="url(#sky2)" />
            <rect x="0" y="200" width="400" height="120" fill="url(#ground2)" />
            <rect x="0" y="240" width="400" height="14" fill="#bdb59c" />
            <polygon points="20,210 90,210 90,165 20,165" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="100,210 160,210 160,140 100,140" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="290,210 360,210 360,150 290,150" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="20,295 80,295 80,260 20,260" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="320,295 380,295 380,260 320,260" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="180,210 270,210 270,80 180,80" fill="#a4be8e" stroke="#3a3a36" strokeWidth="1.4" />
            <rect x="184" y="210" width="82" height="34" fill="#cfb98d" stroke="#3a3a36" strokeWidth="1" />
            {Array.from({ length: 9 }).map((_, row) =>
              Array.from({ length: 4 }).map((_, col) => (
                <rect key={`${row}-${col}`} x={188 + col * 21} y={92 + row * 13} width={12} height={8} fill="#3a4a55" />
              )),
            )}
            <rect x="195" y="216" width="60" height="14" fill="#9ec8d6" stroke="#3a3a36" strokeWidth="0.8" />
            {[40, 95, 150, 230, 300, 365].map((cx, i) => (
              <g key={i} transform={`translate(${cx}, 226)`}><circle r="6" fill="#7a8e58" stroke="#3a3a36" strokeWidth="0.8" /></g>
            ))}
            {[35, 110, 200, 290, 360].map((cx, i) => (
              <g key={i} transform={`translate(${cx}, 280)`}><circle r="7" fill="#8da46e" stroke="#3a3a36" strokeWidth="0.8" /></g>
            ))}
            <rect x="210" y="244" width="14" height="6" fill="#c46f5b" stroke="#3a3a36" strokeWidth="0.6" rx="1" />
            <rect x="135" y="244" width="14" height="6" fill="#5b7d9b" stroke="#3a3a36" strokeWidth="0.6" rx="1" />
          </svg>
        )}
      </div>
      <div className="absolute top-6 left-1/2 -translate-x-1/2 eyebrow text-ink-500 text-[11px]">
        Tab 08 · AI scheme render (Gemini image-to-image)
      </div>
    </div>
  );
}

function ParkingLiftsScene({ t, data }: { t: number; data: SampleData }) {
  const pk = data.parking;
  const lf = data.lifts;
  const blocks = [
    {
      title: "Tab 05 · Parking",
      rows: [
        { k: "Required (apt)", v: `${pk.requiredTotal} std + ${pk.requiredPRM} PRM` },
        { k: "Available", v: `${pk.availableStandard} std + ${pk.availablePRM} PRM` },
        { k: "Balance", v: `${pk.balance >= 0 ? "+" : ""}${pk.balance} std · ${pk.prmBalance >= 0 ? "+" : ""}${pk.prmBalance} PRM` },
        { k: "Levels", v: data.project.parking.map((l) => l.name).join(" · ") },
      ],
      verdict: pk.balance >= 0 && pk.prmBalance >= 0 ? "PASS" : "REVIEW",
    },
    {
      title: "Tab 06 · Lifts (Dubai Building Code D.8.8)",
      rows: [
        { k: "Recommended", v: `${lf.liftsRecommended} lifts` },
        { k: "Population", v: `${fmt0(lf.totalPopulation)} (${lf.occupiedFloors} floors)` },
        { k: "Boarding floors", v: `${lf.boardingFloors}` },
        { k: "Governing", v: lf.governing },
      ],
      verdict: lf.dbcTotal !== null ? "PASS" : "REVIEW",
    },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid grid-cols-2 gap-4 w-[760px]">
        {blocks.map((b, bi) => {
          const local = ease(clamp01((t - bi * 0.18) / 0.4));
          return (
            <div key={b.title} className="border border-ink-200 bg-white shadow-sm grid gap-2 p-4" style={{ opacity: local, transform: `translateY(${(1 - local) * 14}px)` }}>
              <div className="flex items-baseline justify-between">
                <span className="eyebrow text-ink-500 text-[10px]">{b.title}</span>
                <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-[0.10em] ${b.verdict === "PASS" ? "bg-qube-100 text-qube-800" : "bg-amber-100 text-amber-800"}`}>{b.verdict}</span>
              </div>
              <div className="grid gap-1">
                {b.rows.map((r) => (
                  <div key={r.k} className="grid grid-cols-[120px_1fr] gap-2 text-[12px]">
                    <span className="text-ink-500 text-[11px] uppercase tracking-[0.08em]">{r.k}</span>
                    <span className="text-ink-900 tabular-nums">{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultsScene({ t, data }: { t: number; data: SampleData }) {
  const stats = [
    { k: "Total units", v: `${data.program.totalUnits}`, sub: "Studio + 1BR + 2BR + 3BR" },
    { k: "Interior GFA", v: `${fmt0(data.program.totalInteriorGFA)} m²`, sub: "Residential" },
    { k: "Total GFA", v: `${fmt0(data.program.totalGFABuilding)} m²`, sub: `FAR ${data.program.far.toFixed(2)}` },
    { k: "BUA", v: `${fmt0(data.program.totalBUABuilding)} m²`, sub: "with shafts + non-GFA" },
    { k: "Sellable", v: `${fmt0(data.program.totalSellable)} m²`, sub: "Interior + balconies" },
    { k: "Common (GFA)", v: `${fmt0(data.program.commonAreasGFA)} m²`, sub: `${fmtPct(data.program.efficiency.amenitiesPct + data.program.efficiency.circulationPct + data.program.efficiency.servicesPct)} of GFA` },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[760px]">
        <div className="eyebrow text-ink-500">Tab 10 · Results</div>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => {
            const local = ease(clamp01((t - i * 0.10) / 0.3));
            return (
              <div key={s.k} className="border border-ink-200 bg-white p-4 shadow-sm" style={{ opacity: local, transform: `translateY(${(1 - local) * 14}px)` }}>
                <div className="eyebrow text-ink-500 text-[10px]">{s.k}</div>
                <div className="text-[22px] font-light text-ink-900 mt-1 tabular-nums">{s.v}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{s.sub}</div>
              </div>
            );
          })}
        </div>
        <p className="text-[11.5px] text-ink-500">
          All numbers computed live from the {data.project.name} input — no hard-coded results.
        </p>
      </div>
    </div>
  );
}

function OutroScene({ t, onLoadSample }: { t: number; onLoadSample: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-900 text-bone-100 overflow-hidden">
      <div className="absolute inset-0 opacity-15" style={{
        backgroundImage: "linear-gradient(0deg, transparent 95%, #647d57 95%), linear-gradient(90deg, transparent 95%, #647d57 95%)",
        backgroundSize: "60px 60px",
      }} />
      <div className="text-center relative z-10" style={{ opacity: ease(t * 1.6) }}>
        <div className="eyebrow text-qube-300 mb-3" style={{ letterSpacing: "0.4em" }}>QUBE Development</div>
        <h2 className="text-5xl font-light tracking-tight mb-4">Plot Analysis</h2>
        <p className="text-[15px] text-bone-300 max-w-md mx-auto leading-relaxed mb-6">
          Your next study, in minutes — not weeks.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={onLoadSample}
            className="inline-block px-5 py-3 bg-qube-500 text-white text-[12px] font-medium uppercase tracking-[0.15em] hover:bg-qube-600 transition-colors"
          >
            Open this sample in the app →
          </button>
          <Link href="/" className="inline-block px-5 py-3 border border-bone-300/40 text-bone-100 text-[12px] font-medium uppercase tracking-[0.15em] hover:bg-bone-100/10 transition-colors">
            Or start fresh
          </Link>
        </div>
      </div>
    </div>
  );
}

const SCENES: Scene[] = [
  { id: "hero", durationMs: 4000, caption: "Qube Plot Analysis — Production City walkthrough", render: HeroScene },
  { id: "plot", durationMs: 6500, caption: "00 · Trace the parcel — 6,764 m² in IMPZ.", render: ({ t }) => <PlotScene t={t} /> },
  { id: "setup", durationMs: 7000, caption: "01 · Plot, zoning, floors, setbacks.", render: SetupScene },
  { id: "typologies", durationMs: 6500, caption: "02 · 10 unit types — Studio, 1BR (×4), 2BR (×4), 3BR.", render: TypologiesScene },
  { id: "program", durationMs: 8500, caption: "03 · Distribute the typologies floor by floor.", render: ProgramScene },
  { id: "common", durationMs: 7000, caption: "04 · Lobbies, lifts, MEP, gym, pools, BBQ — flagged GFA / BUA / OPEN.", render: CommonAreasScene },
  { id: "parking-lifts", durationMs: 6000, caption: "05 · Parking & 06 · Lifts — Dubai DCD + CIBSE Guide D.", render: ParkingLiftsScene },
  { id: "massing", durationMs: 7500, caption: "08 · Massing in 3D — block, podium, courtyard, twin, stepped, L, U.", render: MassingScene },
  { id: "context", durationMs: 7000, caption: "08 · In-context — drop it on its real plot, edit neighbours.", render: ContextScene },
  { id: "ai", durationMs: 8000, caption: "✦ AI scheme render — Gemini image-to-image.", render: ({ t }) => <AiRenderScene t={t} /> },
  { id: "results", durationMs: 7000, caption: "10 · KPIs computed live — every number is real.", render: ResultsScene },
  { id: "outro", durationMs: 5000, caption: "Open the sample and explore it yourself.", render: () => null },
];
const TOTAL_MS = SCENES.reduce((s, sc) => s + sc.durationMs, 0);

/* -------------------------------------------------------------------------- */
/*                                 Demo page                                  */
/* -------------------------------------------------------------------------- */

export default function DemoPage() {
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const idxRef = useRef(idx);
  const tRef = useRef(t);
  idxRef.current = idx;
  tRef.current = t;

  // Real numbers computed once.
  const data: SampleData = useMemo(() => {
    const project = PRODUCTION_CITY_SAMPLE;
    const program = computeProgram(project);
    const parking = computeParking(project);
    const lifts = computeLifts(project);
    return { project, program, parking, lifts };
  }, []);

  const loadSample = useStore((s) => s.loadSample);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const dur = SCENES[idxRef.current].durationMs;
      const next = tRef.current + dt / dur;
      if (next >= 1) {
        if (idxRef.current < SCENES.length - 1) {
          setIdx(idxRef.current + 1);
          setT(0);
        } else {
          setT(1);
          setPlaying(false);
          setDone(true);
          return;
        }
      } else {
        setT(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const elapsedSec = useMemo(() => {
    let ms = 0;
    for (let i = 0; i < idx; i++) ms += SCENES[i].durationMs;
    ms += SCENES[idx].durationMs * t;
    return ms / 1000;
  }, [idx, t]);

  function restart() { setIdx(0); setT(0); setDone(false); setPlaying(true); }
  function jumpTo(i: number) { setIdx(i); setT(0); setDone(false); setPlaying(true); }

  function handleLoadSample() {
    loadSample();
    if (typeof window !== "undefined") window.location.href = "/";
  }

  const scene = SCENES[idx];

  return (
    <main className="min-h-screen bg-ink-900 text-bone-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[1100px] grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="eyebrow text-qube-300 text-[10px]">QUBE Development</div>
            <h1 className="text-[18px] font-light tracking-tight text-bone-100">Plot Analysis · Demo · {data.project.name}</h1>
          </div>
          <Link href="/" className="text-[11px] uppercase tracking-[0.18em] text-bone-300 hover:text-bone-100 transition-colors">
            Skip to app →
          </Link>
        </div>

        <div className="relative aspect-[16/9] bg-bone-100 border border-ink-700 overflow-hidden shadow-2xl">
          {scene.id === "outro" ? <OutroScene t={t} onLoadSample={handleLoadSample} /> : scene.render({ t, data })}
          <div className="absolute bottom-0 left-0 right-0 px-6 py-3 bg-gradient-to-t from-ink-900/85 to-transparent">
            <div className="text-bone-100 text-[15px] font-light tracking-tight">{scene.caption}</div>
          </div>
          {done && (
            <button onClick={restart} className="absolute top-3 right-3 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.10em] bg-white/90 text-ink-900 border border-ink-200 hover:bg-white">↻ Replay</button>
          )}
        </div>

        <div className="grid gap-2">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <button
              onClick={() => (done ? restart() : setPlaying((p) => !p))}
              className="w-9 h-9 grid place-items-center border border-ink-700 bg-ink-800 hover:bg-ink-700 text-bone-100 transition-colors"
              title={playing ? "Pause" : "Play"}
            >{done ? "↻" : playing ? "❚❚" : "▶"}</button>
            <div className="grid gap-1 h-1.5" style={{ gridTemplateColumns: `repeat(${SCENES.length}, 1fr)` }}>
              {SCENES.map((s, i) => {
                const filled = i < idx ? 1 : i === idx ? t : 0;
                return (
                  <button
                    key={s.id}
                    onClick={() => jumpTo(i)}
                    className="relative bg-ink-700 hover:bg-ink-600"
                    title={s.caption}
                    aria-label={`Jump to scene ${i + 1}: ${s.caption}`}
                  >
                    <span className="absolute inset-y-0 left-0 bg-qube-500" style={{ width: `${filled * 100}%` }} />
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-bone-300 tabular-nums w-[64px] text-right">
              {elapsedSec.toFixed(1)}s / {(TOTAL_MS / 1000).toFixed(0)}s
            </div>
          </div>
          <p className="text-[10.5px] text-bone-300 leading-relaxed">
            Tip — to record a video: open this page in full-screen, hit Play, capture the screen with Loom, OBS or
            <kbd className="mx-1 px-1.5 py-0.5 bg-ink-800 border border-ink-700 rounded text-[10px]">⌘⇧5</kbd>
            on macOS / <kbd className="mx-1 px-1.5 py-0.5 bg-ink-800 border border-ink-700 rounded text-[10px]">Win+G</kbd> on Windows.
          </p>
        </div>
      </div>
    </main>
  );
}
