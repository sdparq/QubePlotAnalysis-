"use client";
import { useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import type { ParcelInfo, ParcelSummary } from "@/lib/types";
import { fileToImage, runOCR, extractSummary } from "@/lib/parcel-extract";
import { DUBAI_ZONES } from "@/lib/standards/dubai";
import { fmt2 } from "@/lib/format";

type Phase = "idle" | "rendering" | "ocr" | "done" | "error";

export default function PlotTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const parcel = project.parcel;

  const [phase, setPhase] = useState<Phase>(parcel ? "done" : "idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhase("rendering");
      const imageDataUrl = await fileToImage(file);
      setPhase("ocr");
      const ocrText = await runOCR(imageDataUrl, (p) => setOcrProgress(p));
      const summary = extractSummary(ocrText);
      const next: ParcelInfo = {
        fileName: file.name,
        fileType: file.type || "image/jpeg",
        imageDataUrl,
        ocrText,
        summary,
        extractedAt: Date.now(),
      };
      patch({ parcel: next });
      setPhase("done");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Could not process this file");
      setPhase("error");
    }
  }

  function updateSummary(patchObj: Partial<ParcelSummary>) {
    if (!parcel) return;
    patch({ parcel: { ...parcel, summary: { ...parcel.summary, ...patchObj } } });
  }

  function clearParcel() {
    if (!confirm("Remove the uploaded plot drawing and its extracted data?")) return;
    patch({ parcel: undefined });
    setPhase("idle");
  }

  function applyToSetup() {
    if (!parcel) return;
    const s = parcel.summary;
    const updates: Partial<typeof project> = {};
    if (s.plotAreaM2 != null && s.plotAreaM2 > 0) updates.plotArea = s.plotAreaM2;
    if (s.community) {
      const match = DUBAI_ZONES.find((z) => z.toLowerCase().includes(s.community!.toLowerCase()) ||
                                            s.community!.toLowerCase().includes(z.toLowerCase()));
      if (match) updates.zone = match;
    }
    if (s.plotNumber && (!project.name || project.name === "New Project" || project.name === "Untitled Project")) {
      updates.name = `Plot ${s.plotNumber}`;
    }
    if (Object.keys(updates).length === 0) {
      alert("Nothing to apply — fill at least plot area or community in the summary.");
      return;
    }
    patch(updates);
    alert(`Applied to Setup:\n${Object.entries(updates).map(([k, v]) => `• ${k}: ${v}`).join("\n")}`);
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Plot drawing</h2>
          <p className="section-sub">Upload the affection plan / plot drawing (PDF or image). We&rsquo;ll OCR the text and extract a summary so you can copy plot area, community and other figures into Setup.</p>
        </div>

        {!parcel && phase === "idle" && (
          <Dropzone onFiles={handleFiles} inputRef={inputRef} />
        )}

        {(phase === "rendering" || phase === "ocr") && (
          <ProgressPanel phase={phase} progress={ocrProgress} />
        )}

        {phase === "error" && (
          <div className="border border-red-200 bg-red-50 text-red-800 p-4 text-sm">
            <div className="font-medium mb-1">Could not process the file</div>
            <div className="text-red-700/80">{error}</div>
            <button className="btn btn-secondary mt-3" onClick={() => setPhase("idle")}>Try another file</button>
          </div>
        )}

        {parcel && (phase === "done" || phase === "idle") && (
          <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
            <div>
              <div className="border border-ink-200 bg-bone-50 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={parcel.imageDataUrl} alt={parcel.fileName} className="w-full h-auto block" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-500">
                <div className="truncate"><span className="font-medium text-ink-700">{parcel.fileName}</span> · {new Date(parcel.extractedAt).toLocaleString()}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn btn-secondary btn-xs" onClick={() => inputRef.current?.click()}>Replace</button>
                  <button className="btn btn-danger btn-xs" onClick={clearParcel}>Remove</button>
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            <SummaryPanel parcel={parcel} onChange={updateSummary} onApply={applyToSetup} />
          </div>
        )}
      </div>

      {parcel && (
        <div className="card">
          <div className="mb-3">
            <h3 className="section-title">Raw OCR text</h3>
            <p className="section-sub">Useful to verify what was read from the drawing. If a field is missing above, you can copy it from here.</p>
          </div>
          <pre className="text-xs bg-bone-50 border border-ink-200 p-4 max-h-64 overflow-auto whitespace-pre-wrap text-ink-700 leading-relaxed">{parcel.ocrText || "(empty)"}</pre>
        </div>
      )}
    </div>
  );
}

function Dropzone({ onFiles, inputRef }: { onFiles: (f: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
      className={`block border-2 border-dashed text-center py-14 px-6 cursor-pointer transition-colors ${
        drag ? "border-qube-500 bg-qube-50" : "border-ink-200 bg-bone-50 hover:border-qube-400 hover:bg-qube-50/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <div className="mx-auto w-10 h-10 mb-4 flex items-center justify-center border border-ink-300 rounded-full">
        <svg className="w-5 h-5 text-ink-700" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 14V4M5 9l5-5 5 5M3 16h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="text-sm font-medium text-ink-900">Drop the plot drawing here, or click to browse</div>
      <div className="text-xs text-ink-500 mt-1">PDF, JPG, PNG · processed locally in your browser</div>
    </label>
  );
}

function ProgressPanel({ phase, progress }: { phase: "rendering" | "ocr"; progress: number }) {
  const pct = phase === "ocr" ? Math.round(progress * 100) : null;
  return (
    <div className="border border-ink-200 bg-bone-50 p-8 text-center">
      <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-4" />
      <div className="text-sm font-medium text-ink-900">
        {phase === "rendering" ? "Rendering the plot…" : "Reading text from the drawing…"}
      </div>
      <div className="text-xs text-ink-500 mt-1">
        {phase === "rendering"
          ? "Decoding PDF / image"
          : pct !== null
          ? `OCR ${pct}%`
          : "Loading the OCR engine (one-time, ~5 MB)"}
      </div>
    </div>
  );
}

function SummaryPanel({
  parcel,
  onChange,
  onApply,
}: {
  parcel: ParcelInfo;
  onChange: (p: Partial<ParcelSummary>) => void;
  onApply: () => void;
}) {
  const s = parcel.summary;
  const detectedCount = Object.values(s).filter((v) => v !== undefined && v !== "").length;

  return (
    <div className="border border-ink-200 bg-white">
      <div className="px-4 py-3 border-b border-ink-200 flex items-center justify-between bg-bone-50">
        <div>
          <div className="eyebrow text-ink-500">Plot summary</div>
          <div className="text-xs text-ink-500 mt-0.5">{detectedCount} fields detected — edit if OCR missed something</div>
        </div>
        <button
          className="px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] bg-qube-500 hover:bg-qube-600 text-white"
          onClick={onApply}
        >Apply to Setup</button>
      </div>
      <dl className="p-4 grid gap-3">
        <Row label="Plot number" value={s.plotNumber ?? ""} onChange={(v) => onChange({ plotNumber: v || undefined })} />
        <Row label="Community" value={s.community ?? ""} onChange={(v) => onChange({ community: v || undefined })} />
        <Row label="Sector / sub-community" value={s.sector ?? ""} onChange={(v) => onChange({ sector: v || undefined })} />
        <NumRow label="Plot area (m²)" value={s.plotAreaM2} onChange={(v) => onChange({ plotAreaM2: v })} />
        <NumRow label="FAR" value={s.far} onChange={(v) => onChange({ far: v })} step={0.05} />
        <NumRow label="Max height (m)" value={s.heightM} onChange={(v) => onChange({ heightM: v })} />
        <NumRow label="Setback front (m)" value={s.setbackFrontM} onChange={(v) => onChange({ setbackFrontM: v })} />
        <NumRow label="Setback side (m)" value={s.setbackSideM} onChange={(v) => onChange({ setbackSideM: v })} />
        <NumRow label="Setback rear (m)" value={s.setbackRearM} onChange={(v) => onChange({ setbackRearM: v })} />
        <Row label="Permitted use" value={s.permittedUse ?? ""} onChange={(v) => onChange({ permittedUse: v || undefined })} />
        {s.plotAreaM2 != null && s.far != null && (
          <div className="mt-1 pt-3 border-t border-ink-100 text-xs text-ink-500">
            Implied max GFA from FAR: <span className="font-medium text-ink-900">{fmt2(s.plotAreaM2 * s.far)} m²</span>
          </div>
        )}
      </dl>
    </div>
  );
}

function Row({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[1fr_minmax(0,1.6fr)] gap-3 items-center">
      <dt className="eyebrow text-ink-500">{label}</dt>
      <dd>
        <input className="cell-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" />
      </dd>
    </div>
  );
}
function NumRow({ label, value, onChange, step = 0.01 }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number }) {
  return (
    <div className="grid grid-cols-[1fr_minmax(0,1.6fr)] gap-3 items-center">
      <dt className="eyebrow text-ink-500">{label}</dt>
      <dd>
        <input
          type="number"
          step={step}
          className="cell-input text-right"
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
          placeholder="—"
        />
      </dd>
    </div>
  );
}
