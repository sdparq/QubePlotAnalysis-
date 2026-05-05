"use client";
import { useRef, useState } from "react";
import { useStore, useProject } from "@/lib/store";
import type { ParcelInfo } from "@/lib/types";
import { fileToImage } from "@/lib/parcel-extract";

type Phase = "idle" | "rendering" | "done" | "error";

export default function PlotTab() {
  const project = useProject();
  const patch = useStore((s) => s.patch);
  const parcel = project.parcel;

  const [phase, setPhase] = useState<Phase>(parcel ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhase("rendering");
      const imageDataUrl = await fileToImage(file);
      const next: ParcelInfo = {
        fileName: file.name,
        fileType: file.type || "image/jpeg",
        imageDataUrl,
        uploadedAt: Date.now(),
      };
      patch({ parcel: next });
      setPhase("done");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Could not process this file");
      setPhase("error");
    }
  }

  function clearParcel() {
    if (!confirm("Remove the uploaded plot drawing?")) return;
    patch({ parcel: undefined });
    setPhase("idle");
  }

  return (
    <div className="grid gap-6">
      <div className="card">
        <div className="mb-5">
          <h2 className="section-title">Plot drawing</h2>
          <p className="section-sub">Upload the affection plan or plot drawing (PDF or image) to keep it as a visual reference for this analysis.</p>
        </div>

        {!parcel && phase === "idle" && (
          <Dropzone onFiles={handleFiles} inputRef={inputRef} />
        )}

        {phase === "rendering" && (
          <div className="border border-ink-200 bg-bone-50 p-8 text-center">
            <div className="mx-auto w-8 h-8 border-2 border-qube-500 border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-sm font-medium text-ink-900">Loading the plot…</div>
            <div className="text-xs text-ink-500 mt-1">Decoding PDF / image</div>
          </div>
        )}

        {phase === "error" && (
          <div className="border border-red-200 bg-red-50 text-red-800 p-4 text-sm">
            <div className="font-medium mb-1">Could not process the file</div>
            <div className="text-red-700/80">{error}</div>
            <button className="btn btn-secondary mt-3" onClick={() => setPhase("idle")}>Try another file</button>
          </div>
        )}

        {parcel && (phase === "done" || phase === "idle") && (
          <div>
            <div className="border border-ink-200 bg-bone-50 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={parcel.imageDataUrl} alt={parcel.fileName} className="w-full h-auto block" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-500">
              <div className="truncate">
                <span className="font-medium text-ink-700">{parcel.fileName}</span>
                <span className="mx-2">·</span>
                <span>uploaded {new Date(parcel.uploadedAt).toLocaleString()}</span>
              </div>
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
        )}
      </div>
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
      <div className="text-xs text-ink-500 mt-1">PDF, JPG, PNG · stored locally in your browser</div>
    </label>
  );
}
