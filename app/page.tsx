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
  { id: "setup", label: "1. Setup" },
  { id: "typologies", label: "2. Typologies" },
  { id: "program", label: "3. Program" },
  { id: "common", label: "4. Common Areas" },
  { id: "parking", label: "5. Parking" },
  { id: "lifts", label: "6. Lifts" },
  { id: "results", label: "Results & Export" },
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
      <nav className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {tab === "setup" && <SetupTab />}
        {tab === "typologies" && <TypologiesTab />}
        {tab === "program" && <ProgramTab />}
        {tab === "common" && <CommonAreasTab />}
        {tab === "parking" && <ParkingTab />}
        {tab === "lifts" && <LiftsTab />}
        {tab === "results" && <ResultsTab />}
      </main>
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
        Qube Plot Analysis · {project.name} · Auto-saved locally
      </footer>
    </div>
  );
}
