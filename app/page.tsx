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
import MassingTab from "@/components/massing-tab";
import ZonesTab from "@/components/zones-tab";
import SummaryTab from "@/components/summary-tab";
import HeaderBar from "@/components/header-bar";

const TABS = [
  { id: "plot", num: "00", label: "Plot" },
  { id: "setup", num: "01", label: "Setup" },
  { id: "common", num: "02", label: "Distribution" },
  { id: "typologies", num: "03", label: "Typologies" },
  { id: "program", num: "04", label: "Apartments" },
  { id: "parking", num: "05", label: "Parking" },
  { id: "lifts", num: "06", label: "Lifts" },
  { id: "massing", num: "07", label: "Massing" },
  { id: "summary", num: "08", label: "Areas Summary" },
] as const;

type TabId = (typeof TABS)[number]["id"] | "zones";

/** The Class Library is the shared pricing/mix database — hidden from the
 *  regular tab bar and admin-gated. Only the SHA-256 of the password ships in
 *  the bundle. Override at build time with NEXT_PUBLIC_LIBRARY_PASSWORD_SHA256. */
const LIBRARY_PASSWORD_SHA256 =
  process.env.NEXT_PUBLIC_LIBRARY_PASSWORD_SHA256 ??
  "f8a23191d373d8775c92fb267f8333b8331ed31a23d94da28ca7e7a857bb4cf5";
const LIBRARY_UNLOCK_KEY = "qube-library-unlock";

async function sha256Hex(text: string): Promise<string> {
  const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function Page() {
  const [tab, setTab] = useState<TabId>("setup");
  const [hydrated, setHydrated] = useState(false);
  const [libraryUnlocked, setLibraryUnlocked] = useState(false);
  const project = useProject();

  useEffect(() => {
    setLibraryUnlocked(window.sessionStorage.getItem(LIBRARY_UNLOCK_KEY) === "1");
    setHydrated(true);
  }, []);
  // The tab bar stays pinned while scrolling, so a new tab would otherwise
  // open half-way down: bring its top under the bar.
  useEffect(() => {
    // The bar's resting position is right under the header (once pinned,
    // its own rect always reads 0).
    const navTop = document.querySelector("header")?.offsetHeight ?? 0;
    if (window.scrollY > navTop) window.scrollTo({ top: navTop });
  }, [tab]);
  if (!hydrated) return null;

  async function openLibrary() {
    if (libraryUnlocked) {
      setTab("zones");
      return;
    }
    const pw = window.prompt("The Class Library is restricted.\nEnter the admin password:");
    if (pw == null || pw === "") return;
    try {
      if ((await sha256Hex(pw)) !== LIBRARY_PASSWORD_SHA256) {
        window.alert("Wrong password.");
        return;
      }
    } catch {
      window.alert("Password check needs a secure (https) context — open the deployed site.");
      return;
    }
    window.sessionStorage.setItem(LIBRARY_UNLOCK_KEY, "1");
    setLibraryUnlocked(true);
    setTab("zones");
  }

  function lockLibrary() {
    window.sessionStorage.removeItem(LIBRARY_UNLOCK_KEY);
    setLibraryUnlocked(false);
    setTab("setup");
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-clip">
      <HeaderBar />
      <nav className="border-b border-ink-200 bg-white/95 backdrop-blur-md sticky top-0 z-40 shadow-[0_1px_0_rgba(14,14,14,0.02),0_6px_18px_-14px_rgba(14,14,14,0.25)]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-wrap gap-x-1 gap-y-0 items-center">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`group relative px-4 py-4 text-[13px] font-semibold transition-colors flex items-baseline gap-2 ${
                    active ? "text-ink-900" : "text-ink-500 hover:text-ink-900"
                  }`}
                  style={{ letterSpacing: "0.06em" }}
                  aria-current={active ? "page" : undefined}
                >
                  <span className={`text-[10px] font-medium transition-colors ${active ? "text-qube-600" : "text-ink-400 group-hover:text-qube-500"}`}>{t.num}</span>
                  <span className="uppercase">{t.label}</span>
                  <span
                    className={`absolute left-3 right-3 -bottom-px h-0.5 transition-all ${
                      active ? "bg-qube-500 opacity-100" : "bg-ink-300 opacity-0 group-hover:opacity-100"
                    }`}
                  />
                </button>
              );
            })}
            {libraryUnlocked ? (
              <div className="ml-auto flex items-center">
                <button
                  onClick={() => setTab("zones")}
                  className={`relative px-4 py-4 text-[13px] font-semibold transition-colors flex items-baseline gap-2 ${
                    tab === "zones" ? "text-ink-900" : "text-ink-500 hover:text-ink-900"
                  }`}
                  style={{ letterSpacing: "0.06em" }}
                >
                  <span className={`text-[10px] font-medium ${tab === "zones" ? "text-qube-600" : "text-ink-400"}`}>L</span>
                  <span className="uppercase">Class Library</span>
                  {tab === "zones" && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-qube-500" />}
                </button>
                <button
                  onClick={lockLibrary}
                  className="px-2 py-4 text-[12px] text-ink-400 hover:text-ink-700 transition-colors"
                  title="Lock the Class Library again"
                >
                  🔓
                </button>
              </div>
            ) : (
              <button
                onClick={() => void openLibrary()}
                className="ml-auto px-3 py-4 text-[12px] text-ink-300 hover:text-ink-600 transition-colors"
                title="Admin"
                aria-label="Admin access"
              >
                🔒
              </button>
            )}
          </div>
        </div>
      </nav>
      <main className="flex-1 w-full">
        <div className="max-w-7xl mx-auto px-6 py-8 min-w-0">
          {tab === "zones" && libraryUnlocked && <ZonesTab />}
          {tab === "plot" && <PlotTab />}
          {tab === "setup" && <SetupTab />}
          {tab === "typologies" && <TypologiesTab />}
          {tab === "program" && <ProgramTab />}
          {tab === "common" && <CommonAreasTab />}
          {tab === "summary" && <SummaryTab />}
          {tab === "parking" && <ParkingTab />}
          {tab === "lifts" && <LiftsTab />}
          {tab === "massing" && <MassingTab />}
        </div>
      </main>
      <footer className="border-t border-ink-200 bg-bone-50 py-4">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4 text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
          <span>QUBE · Plot Feasibility</span>
          <span className="truncate">{project.name} · Auto-saved locally</span>
        </div>
      </footer>
    </div>
  );
}
