"use client";
import { useEffect, useState } from "react";
import { useProject } from "@/lib/store";
import PlotTab from "@/components/plot-tab";
import SetupTab from "@/components/setup-tab";
import TypologiesTab from "@/components/typologies-tab";
import ProgramTab from "@/components/program-tab";
import CommonAreasTab from "@/components/common-areas-tab";
import ParkingTab from "@/components/parking-tab";
import LiftsTab from "@/components/lifts-tab";
import GarbageTab from "@/components/garbage-tab";
import MassingTab from "@/components/massing-tab";
import EconomicTab from "@/components/economic-tab";
import ZonesTab from "@/components/zones-tab";
import SummaryTab from "@/components/summary-tab";
import HeaderBar from "@/components/header-bar";

const TABS = [
  { id: "zones", num: "L", label: "Class Library" },
  { id: "plot", num: "00", label: "Plot" },
  { id: "setup", num: "01", label: "Setup" },
  { id: "typologies", num: "02", label: "Typologies" },
  { id: "program", num: "03", label: "Program" },
  { id: "common", num: "04", label: "Common Areas" },
  { id: "summary", num: "05", label: "Areas Summary" },
  { id: "parking", num: "06", label: "Parking" },
  { id: "lifts", num: "07", label: "Lifts" },
  { id: "garbage", num: "08", label: "Garbage" },
  { id: "massing", num: "09", label: "Massing" },
  { id: "economic", num: "10", label: "Economic" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Page() {
  const [tab, setTab] = useState<TabId>("setup");
  const [hydrated, setHydrated] = useState(false);
  const project = useProject();

  useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <HeaderBar />
      <nav className="border-b border-ink-200 bg-white sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-wrap gap-x-1 gap-y-0">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative px-4 py-4 text-[13px] font-semibold transition-colors flex items-baseline gap-2 ${
                    active ? "text-ink-900" : "text-ink-500 hover:text-ink-900"
                  }`}
                  style={{ letterSpacing: "0.06em" }}
                >
                  <span className={`text-[10px] font-medium ${active ? "text-qube-600" : "text-ink-400"}`}>{t.num}</span>
                  <span className="uppercase">{t.label}</span>
                  {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-qube-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
      <main className="flex-1 w-full">
        <div className="max-w-7xl mx-auto px-6 py-8 min-w-0">
          {tab === "zones" && <ZonesTab />}
          {tab === "plot" && <PlotTab />}
          {tab === "setup" && <SetupTab />}
          {tab === "typologies" && <TypologiesTab />}
          {tab === "program" && <ProgramTab />}
          {tab === "common" && <CommonAreasTab />}
          {tab === "summary" && <SummaryTab />}
          {tab === "parking" && <ParkingTab />}
          {tab === "lifts" && <LiftsTab />}
          {tab === "garbage" && <GarbageTab />}
          {tab === "massing" && <MassingTab />}
          {tab === "economic" && <EconomicTab />}
        </div>
      </main>
      <footer className="border-t border-ink-200 bg-bone-50 py-4">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4 text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
          <span>QUBE · Plot Feasibility</span>
          <a href="/demo" className="text-qube-700 hover:text-qube-900 transition-colors">▶ Watch demo</a>
          <span className="truncate">{project.name} · Auto-saved locally</span>
        </div>
      </footer>
    </div>
  );
}
