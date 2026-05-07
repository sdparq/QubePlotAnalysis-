"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Self-contained scripted promo of the Qube Plot Analysis app, walked through
 * with a Dubai Islands example. Auto-advances scene by scene; record the page
 * with a screen capture tool to produce a video.
 */

type Render = (p: { t: number }) => React.ReactNode;

interface Scene {
  id: string;
  durationMs: number;
  caption: string;
  render: Render;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function HeroScene({ t }: { t: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-bone-100 to-bone-200">
      <div className="absolute inset-0 opacity-[0.06]" style={{
        backgroundImage: "linear-gradient(0deg, transparent 95%, #647d57 95%), linear-gradient(90deg, transparent 95%, #647d57 95%)",
        backgroundSize: "40px 40px",
      }} />
      <div className="text-center relative z-10" style={{ opacity: ease(t * 1.4), transform: `translateY(${(1 - ease(t * 1.4)) * 12}px)` }}>
        <div className="eyebrow text-qube-700 mb-4" style={{ letterSpacing: "0.4em" }}>
          QUBE Development · Internal tool
        </div>
        <h1 className="text-6xl md:text-7xl font-light text-ink-900 tracking-tight mb-4">
          Plot Analysis
        </h1>
        <p className="text-lg text-ink-500 max-w-xl mx-auto leading-relaxed">
          From a parcel drawing to a feasibility report —
          <br /> in one tool.
        </p>
      </div>
    </div>
  );
}

function TraceScene({ t }: { t: number }) {
  const verts: [number, number][] = [
    [120, 90], [510, 110], [555, 235], [430, 330], [205, 320], [85, 220],
  ];
  const total = verts.length;
  const shown = Math.min(total, Math.floor(ease(t * 1.4) * (total + 1)));
  const closed = ease(t * 1.4) >= 1;
  let d = "";
  for (let i = 0; i < shown; i++) d += (i === 0 ? "M" : "L") + verts[i].join(",");
  if (closed) d += " Z";
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3" style={{ opacity: ease(Math.min(1, t * 5)) }}>
        <div className="flex items-baseline gap-3">
          <span className="eyebrow text-ink-500">Tab 0 · Plot</span>
          <span className="text-[11px] text-ink-400">Dubai Islands · parcel D-14</span>
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
          {closed && (
            <g style={{ opacity: ease((t - 0.7) / 0.3) }}>
              <text x="320" y="230" textAnchor="middle" fill="#33422e" fontSize="14" fontFamily="ui-monospace, monospace">12,840 m²</text>
              <text x="320" y="250" textAnchor="middle" fill="#647d57" fontSize="11" fontFamily="ui-monospace, monospace">scaled · 2 m ref</text>
            </g>
          )}
        </svg>
        <p className="text-[12px] text-ink-500 max-w-[640px] leading-relaxed">
          Upload the PDF or JPG. Trace the parcel, set a 2-point scale,
          and the plot area is computed automatically.
        </p>
      </div>
    </div>
  );
}

function SetupScene({ t }: { t: number }) {
  const lines = [
    { k: "Project name", v: "Dubai Islands · D-14" },
    { k: "Zone", v: "Residential · R-3" },
    { k: "Plot area", v: "12,840 m²" },
    { k: "Floors", v: "14" },
    { k: "Floor height", v: "3.20 m" },
    { k: "Latitude", v: "25.2587° N" },
    { k: "Longitude", v: "55.1370° E" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[560px]">
        <div className="eyebrow text-ink-500">Tab 1 · Setup</div>
        <div className="border border-ink-200 bg-white shadow-sm divide-y divide-ink-100">
          {lines.map((l, i) => {
            const start = 0.05 + i * 0.10;
            const local = clamp01((t - start) / 0.18);
            const reveal = Math.floor(local * l.v.length);
            return (
              <div key={l.k} className="grid grid-cols-[180px_1fr] px-4 py-2.5 items-baseline">
                <span className="text-[11px] uppercase tracking-[0.10em] text-ink-500">{l.k}</span>
                <span className="text-[14px] text-ink-900 tabular-nums">
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

function ProgramScene({ t }: { t: number }) {
  const cols = ["1BR", "2BR", "3BR", "PH"];
  const rows = 14;
  const matrix: number[][] = [
    [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0],
    [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0], [4, 4, 2, 0],
    [3, 4, 3, 0], [3, 4, 3, 0], [2, 3, 3, 1], [0, 0, 2, 2],
  ];
  const totalCells = rows * cols.length;
  const shown = Math.floor(ease(t * 1.05) * totalCells);
  const totals = cols.map((_, ci) =>
    matrix.reduce((s, r, ri) => s + (ri * cols.length + ci < shown ? r[ci] : 0), 0),
  );
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3">
        <div className="eyebrow text-ink-500">Tab 3 · Program</div>
        <div className="border border-ink-200 bg-white shadow-sm">
          <div className="grid grid-cols-[60px_repeat(4,72px)_80px] text-[11px] uppercase tracking-[0.08em] text-ink-500 bg-bone-50 border-b border-ink-200">
            <div className="px-2 py-1.5">Floor</div>
            {cols.map((c) => (
              <div key={c} className="px-2 py-1.5 text-center">{c}</div>
            ))}
            <div className="px-2 py-1.5 text-right">Total</div>
          </div>
          {Array.from({ length: rows }).map((_, ri) => {
            const row = matrix[ri];
            const rowTotal = row.reduce((s, v, ci) => s + (ri * cols.length + ci < shown ? v : 0), 0);
            return (
              <div key={ri} className="grid grid-cols-[60px_repeat(4,72px)_80px] text-[12px] tabular-nums border-b border-ink-100 last:border-b-0">
                <div className="px-2 py-1 text-ink-500">{rows - ri}</div>
                {row.map((v, ci) => {
                  const cellIndex = ri * cols.length + ci;
                  const visible = cellIndex < shown;
                  return (
                    <div
                      key={ci}
                      className="px-2 py-1 text-center"
                      style={{
                        opacity: visible ? 1 : 0,
                        background: visible ? (v > 0 ? "#f0f4ec" : "transparent") : "transparent",
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
          <div className="grid grid-cols-[60px_repeat(4,72px)_80px] text-[12px] tabular-nums bg-qube-50 font-medium">
            <div className="px-2 py-1.5 text-qube-800 uppercase text-[11px] tracking-[0.10em]">Total</div>
            {totals.map((tt, i) => (
              <div key={i} className="px-2 py-1.5 text-center text-qube-800">{tt}</div>
            ))}
            <div className="px-2 py-1.5 text-right text-qube-800">{totals.reduce((a, b) => a + b, 0)}</div>
          </div>
        </div>
        <p className="text-[12px] text-ink-500">
          Define your typologies once — distribute them across floors with a single matrix.
        </p>
      </div>
    </div>
  );
}

function MassingScene({ t }: { t: number }) {
  const floors = 14;
  const visible = Math.min(floors, Math.floor(ease(t * 1.6) * floors) + 1);
  const yaw = -30 + ease(Math.max(0, (t - 0.4) / 0.6)) * 35;
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
        {/* Plot outline */}
        <div className="absolute inset-0 border border-ink-300/70 bg-bone-50/40" />
        {/* Floors */}
        {Array.from({ length: visible }).map((_, i) => {
          const w = 200 - Math.max(0, i - 9) * 22;
          const isPodium = i < 2;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: "50%",
                top: "50%",
                width: w,
                height: w,
                transform: `translate3d(-50%, -50%, ${i * 16}px)`,
                background: isPodium ? "#8a9a76" : "#647d57",
                border: "1px solid #33422e",
                opacity: 0.96,
                boxShadow: i === visible - 1 ? "0 4px 18px rgba(0,0,0,0.18)" : "none",
                transition: "background 200ms",
              }}
            />
          );
        })}
      </div>
      <div className="absolute top-6 left-6 grid gap-1 text-ink-700">
        <div className="eyebrow text-ink-500">Tab 6 · Massing 3D</div>
        <div className="text-[15px] font-medium">Podium + Tower</div>
        <div className="text-[11px] text-ink-500 tabular-nums">{visible} floors · {Math.round((visible) * 3.2)} m</div>
      </div>
      <div className="absolute bottom-6 left-6 right-6 flex items-center gap-2">
        {(["Block", "Podium", "Courtyard", "Twin", "Stepped", "L-shape"] as const).map((s, i) => (
          <div
            key={s}
            className={`px-2 py-1 text-[10.5px] uppercase tracking-[0.10em] border ${i === 1 ? "bg-qube-500 text-white border-qube-500" : "border-ink-300 text-ink-700 bg-white"}`}
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
        width: 700,
        height: 460,
        transformStyle: "preserve-3d",
        transform: "perspective(1400px) rotateX(56deg) rotateZ(-22deg)",
      }}>
        <div className="absolute inset-0" style={{
          background: "linear-gradient(135deg, #d8d7cb 0%, #c4c2b3 100%)",
        }} />
        {/* roads */}
        <div className="absolute" style={{ left: 0, top: 175, width: "100%", height: 14, background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 0, top: 325, width: "100%", height: 12, background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 195, top: 0, width: 14, height: "100%", background: "#aaa9a0" }} />
        <div className="absolute" style={{ left: 510, top: 0, width: 14, height: "100%", background: "#aaa9a0" }} />
        {neighbors.map((n, i) => {
          const localStart = 0.04 + i * 0.04;
          const local = ease(clamp01((t - localStart) / 0.25));
          return (
            <div key={i} style={{ position: "absolute", left: n.x, top: n.y, width: n.w, height: n.h, opacity: local }}>
              <div className="absolute inset-0" style={{
                background: "#f3f1ec",
                border: "1px solid #aeada6",
                transform: `translateZ(${24 * local}px)`,
              }} />
              {n.tower && (
                <div style={{
                  position: "absolute",
                  left: "20%", top: "20%", width: "60%", height: "60%",
                  background: "#e9e6dc",
                  border: "1px solid #aeada6",
                  transform: `translateZ(${(24 + n.tower) * local}px)`,
                }} />
              )}
            </div>
          );
        })}
        {/* Project building (hero) — sage green podium + tower */}
        <div style={{ position: "absolute", left: 270, top: 185, width: 170, height: 130, opacity: heroOpacity }}>
          <div className="absolute inset-0" style={{
            background: "#647d57",
            border: "1px solid #33422e",
            transform: "translateZ(40px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }} />
          <div style={{
            position: "absolute",
            left: "22%", top: "22%", width: "56%", height: "56%",
            background: "#7a9468",
            border: "1px solid #33422e",
            transform: "translateZ(160px)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
          }} />
        </div>
      </div>
      <div className="absolute top-6 left-6 grid gap-1 text-ink-900">
        <div className="eyebrow text-ink-500">Tab 6 · In-context</div>
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
        <div className="absolute inset-0 flex items-center justify-center" style={{
          background: "radial-gradient(circle at 50% 30%, #f3efe2 0%, #d9d4c0 100%)",
        }}>
          <div className="relative" style={{
            width: 220, height: 220,
            transformStyle: "preserve-3d",
            transform: "perspective(1100px) rotateX(58deg) rotateZ(-30deg)",
          }}>
            {Array.from({ length: 14 }).map((_, i) => {
              const w = 140 - Math.max(0, i - 9) * 16;
              return (
                <div key={i} className="absolute" style={{
                  left: "50%", top: "50%", width: w, height: w,
                  transform: `translate3d(-50%, -50%, ${i * 11}px)`,
                  background: i < 2 ? "#8a9a76" : "#647d57",
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
          <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-[12px] italic">
            Click ✦ Render scheme
          </div>
        )}
        {phase === "rendering" && (
          <div className="absolute inset-0 flex items-center justify-center grid gap-3 justify-items-center">
            <div className="w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-[12px] text-ink-700">Rendering with Gemini…</div>
          </div>
        )}
        {phase === "output" && (
          <svg viewBox="0 0 400 320" className="w-full h-full" style={{ opacity: ease((t - 0.7) / 0.3) }}>
            {/* sky */}
            <defs>
              <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#cfe1ec" />
                <stop offset="100%" stopColor="#f1ede0" />
              </linearGradient>
              <linearGradient id="ground" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e8e0c8" />
                <stop offset="100%" stopColor="#d5cca9" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="400" height="200" fill="url(#sky)" />
            <rect x="0" y="200" width="400" height="120" fill="url(#ground)" />
            {/* roads */}
            <rect x="0" y="240" width="400" height="14" fill="#bdb59c" />
            {/* white neighbours */}
            <polygon points="20,210 90,210 90,165 20,165" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="100,210 160,210 160,140 100,140" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="290,210 360,210 360,150 290,150" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="20,295 80,295 80,260 20,260" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            <polygon points="320,295 380,295 380,260 320,260" fill="#ffffff" stroke="#3a3a36" strokeWidth="1" />
            {/* our building */}
            <polygon points="180,210 270,210 270,80 180,80" fill="#a4be8e" stroke="#3a3a36" strokeWidth="1.4" />
            <rect x="184" y="210" width="82" height="34" fill="#cfb98d" stroke="#3a3a36" strokeWidth="1" />
            {/* windows grid */}
            {Array.from({ length: 9 }).map((_, row) =>
              Array.from({ length: 4 }).map((_, col) => (
                <rect key={`${row}-${col}`} x={188 + col * 21} y={92 + row * 13} width={12} height={8}
                  fill="#3a4a55" />
              )),
            )}
            {/* pool on podium */}
            <rect x="195" y="216" width="60" height="14" fill="#9ec8d6" stroke="#3a3a36" strokeWidth="0.8" />
            {/* trees */}
            {[40, 95, 150, 230, 300, 365].map((cx, i) => (
              <g key={i} transform={`translate(${cx}, 226)`}>
                <circle r="6" fill="#7a8e58" stroke="#3a3a36" strokeWidth="0.8" />
              </g>
            ))}
            {[35, 110, 200, 290, 360].map((cx, i) => (
              <g key={i} transform={`translate(${cx}, 280)`}>
                <circle r="7" fill="#8da46e" stroke="#3a3a36" strokeWidth="0.8" />
              </g>
            ))}
            {/* car */}
            <rect x="210" y="244" width="14" height="6" fill="#c46f5b" stroke="#3a3a36" strokeWidth="0.6" rx="1" />
            <rect x="135" y="244" width="14" height="6" fill="#5b7d9b" stroke="#3a3a36" strokeWidth="0.6" rx="1" />
          </svg>
        )}
      </div>
      <div className="absolute top-6 left-1/2 -translate-x-1/2 eyebrow text-ink-500 text-[11px]">
        Tab 6 · AI scheme render (Gemini image-to-image)
      </div>
    </div>
  );
}

function ResultsScene({ t }: { t: number }) {
  const stats = [
    { k: "GFA", v: "23,860 m²", sub: "FAR 1.86" },
    { k: "Units", v: "182", sub: "1BR · 2BR · 3BR · PH" },
    { k: "Parking", v: "210 / 198", sub: "Required / available" },
    { k: "Lifts", v: "4 cabins", sub: "CIBSE Guide D — pass" },
    { k: "Common areas", v: "3,420 m²", sub: "14% of GFA" },
    { k: "Profit margin", v: "23.4%", sub: "ROI 38%" },
  ];
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bone-50">
      <div className="grid gap-3 w-[700px]">
        <div className="eyebrow text-ink-500">Tab 9 · Results</div>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => {
            const local = ease(clamp01((t - i * 0.12) / 0.3));
            return (
              <div
                key={s.k}
                className="border border-ink-200 bg-white p-4 shadow-sm"
                style={{ opacity: local, transform: `translateY(${(1 - local) * 14}px)` }}
              >
                <div className="eyebrow text-ink-500 text-[10px]">{s.k}</div>
                <div className="text-[22px] font-light text-ink-900 mt-1 tabular-nums">{s.v}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{s.sub}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OutroScene({ t }: { t: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-900 text-bone-100 overflow-hidden">
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: "linear-gradient(0deg, transparent 95%, #647d57 95%), linear-gradient(90deg, transparent 95%, #647d57 95%)",
        backgroundSize: "60px 60px",
      }} />
      <div className="text-center relative z-10" style={{ opacity: ease(t * 1.6) }}>
        <div className="eyebrow text-qube-300 mb-3" style={{ letterSpacing: "0.4em" }}>QUBE Development</div>
        <h2 className="text-5xl font-light tracking-tight mb-4">Plot Analysis</h2>
        <p className="text-[15px] text-bone-300 max-w-md mx-auto leading-relaxed mb-6">
          Your next study, in minutes — not weeks.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-qube-500 text-white text-[12px] font-medium uppercase tracking-[0.15em] hover:bg-qube-600 transition-colors"
        >
          Open the app →
        </Link>
      </div>
    </div>
  );
}

const SCENES: Scene[] = [
  { id: "hero", durationMs: 3500, caption: "Qube Plot Analysis — Dubai Islands walkthrough", render: HeroScene },
  { id: "trace", durationMs: 6500, caption: "1 · Trace your parcel from a PDF or aerial image", render: TraceScene },
  { id: "setup", durationMs: 7000, caption: "2 · Fill in plot, zoning and floors — once.", render: SetupScene },
  { id: "program", durationMs: 7000, caption: "3 · Mix typologies floor by floor.", render: ProgramScene },
  { id: "massing", durationMs: 8000, caption: "4 · Sculpt the volume — block, podium, courtyard, twin, stepped, L-shape.", render: MassingScene },
  { id: "context", durationMs: 7000, caption: "5 · Drop it on the real plot — neighbours from OSM, edit heights with one click.", render: ContextScene },
  { id: "ai", durationMs: 8500, caption: "6 · Render an axonometric scheme with Gemini, in seconds.", render: AiRenderScene },
  { id: "results", durationMs: 6000, caption: "7 · Read the KPIs — GFA, FAR, parking, lifts, profit margin.", render: ResultsScene },
  { id: "outro", durationMs: 4500, caption: "Open the app and start your own study.", render: OutroScene },
];

const TOTAL_MS = SCENES.reduce((s, sc) => s + sc.durationMs, 0);

export default function DemoPage() {
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const idxRef = useRef(idx);
  const tRef = useRef(t);
  idxRef.current = idx;
  tRef.current = t;

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

  function restart() {
    setIdx(0);
    setT(0);
    setDone(false);
    setPlaying(true);
  }

  function jumpTo(i: number) {
    setIdx(i);
    setT(0);
    setDone(false);
    setPlaying(true);
  }

  const scene = SCENES[idx];

  return (
    <main className="min-h-screen bg-ink-900 text-bone-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[1100px] grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="eyebrow text-qube-300 text-[10px]">QUBE Development</div>
            <h1 className="text-[18px] font-light tracking-tight text-bone-100">Plot Analysis · Demo</h1>
          </div>
          <Link href="/" className="text-[11px] uppercase tracking-[0.18em] text-bone-300 hover:text-bone-100 transition-colors">
            Skip to app →
          </Link>
        </div>

        <div className="relative aspect-[16/9] bg-bone-100 border border-ink-700 overflow-hidden shadow-2xl">
          {scene.render({ t })}
          {/* Caption */}
          <div className="absolute bottom-0 left-0 right-0 px-6 py-3 bg-gradient-to-t from-ink-900/85 to-transparent">
            <div className="text-bone-100 text-[15px] font-light tracking-tight">{scene.caption}</div>
          </div>
          {/* Restart overlay when done */}
          {done && (
            <button
              onClick={restart}
              className="absolute top-3 right-3 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.10em] bg-white/90 text-ink-900 border border-ink-200 hover:bg-white"
            >↻ Replay</button>
          )}
        </div>

        {/* Controls */}
        <div className="grid gap-2">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <button
              onClick={() => (done ? restart() : setPlaying((p) => !p))}
              className="w-9 h-9 grid place-items-center border border-ink-700 bg-ink-800 hover:bg-ink-700 text-bone-100 transition-colors"
              title={playing ? "Pause" : "Play"}
            >
              {done ? "↻" : playing ? "❚❚" : "▶"}
            </button>
            <div className="grid grid-cols-9 gap-1 h-1.5">
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
                    <span
                      className="absolute inset-y-0 left-0 bg-qube-500"
                      style={{ width: `${filled * 100}%` }}
                    />
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
