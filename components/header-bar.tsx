"use client";
import ProjectSwitcher from "./project-switcher";
import CloudStatus from "./cloud-status";

export default function HeaderBar() {
  return (
    <header className="bg-ink-900 text-bone-100 relative z-30">
      <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-6 flex-wrap min-w-0">
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-3">
            <svg
              viewBox="0 0 100 100"
              className="w-9 h-9"
              fill="none"
              stroke="#0f7a35"
              strokeWidth={11}
              strokeLinejoin="miter"
              strokeMiterlimit={4}
              aria-label="QUBE logo"
            >
              <path d="M 8 8 L 72 8 L 92 28 L 92 92 L 28 92 L 8 72 Z" />
            </svg>
            <div className="leading-tight">
              <div className="wordmark text-bone-100 text-[16px]">QUBE</div>
              <div className="eyebrow text-bone-200/60 text-[9px] mt-0.5">Development</div>
            </div>
          </div>
          <div className="hidden sm:block w-px h-10 bg-bone-100/20" />
          <ProjectSwitcher />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <CloudStatus />
        </div>
      </div>
    </header>
  );
}
