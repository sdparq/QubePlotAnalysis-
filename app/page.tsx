"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import SetupTab from "@/components/setup-tab";
import TypologiesTab from "@/components/typologies-tab";
import ProgramTab from "@/components/program-tab";
import CommonAreasTab from "@/components/common-areas-tab";
import ParkingTab from "@/components/parking-tab";
import LiftsTab from "@/components/lifts-tab";
import ResultsTab from "@/components/results-tab";
import HeaderBar from "@/components/header-bar";

const TABS = [
  { id: "setup", num: "01", label: "Setup" },
  { id: "typologies", num: "02", label: "Typologies" },
  { id: "program", num: "03", label: "Program" },
  { id: "common", num: "04", label: "Common Areas" },
  { id: "parking", num: "05", label: "Parking" },
  { id: "lifts", num: "06", label: "Lifts" },
  { id: "results", num: "—", label: "Results" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Page() {
  const [tab, setTab] = useState<TabId>("setup");
  const [hydrated, setHydrated] = useState(false);
  const project = useStore((s) => s.project);

  useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <HeaderBar />
      <nav className="border-b border-ink-200 bg-bone-50">
        <div className="max-w-7xl mx-auto px-6 flex gap-0 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap px-5 py-4 text-[12px] font-medium border-b-2 transition-colors flex items-baseline gap-2 ${
                  active
                    ? "border-qube-500 text-ink-900"
                    : "border-transparent text-ink-500 hover:text-ink-900"
                }`}
                style={{ letterSpacing: "0.10em", textTransform: "uppercase" }}
              >
                <span className={`text-[10px] ${active ? "text-qube-600" : "text-ink-400"}`}>{t.num}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {tab === "setup" && <SetupTab />}
        {tab === "typologies" && <TypologiesTab />}
        {tab === "program" && <ProgramTab />}
        {tab === "common" && <CommonAreasTab />}
        {tab === "parking" && <ParkingTab />}
        {tab === "lifts" && <LiftsTab />}
        {tab === "results" && <ResultsTab />}
      </main>
      <footer className="border-t border-ink-200 bg-bone-50 py-4">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
          <span>QUBE · Plot Feasibility</span>
          <span>{project.name} · Auto-saved locally</span>
        </div>
      </footer>
    </div>
  );
}
