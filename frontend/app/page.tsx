"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="5" width="3" height="10" rx="1.5" fill="var(--accent)" opacity="0.5" />
        <rect x="7.5" y="3" width="3" height="12" rx="1.5" fill="var(--accent)" opacity="0.75" />
        <rect x="13" y="1" width="3" height="14" rx="1.5" fill="var(--accent)" />
      </svg>
    ),
    label: "EDA Profile",
    desc: "Distribution, stats & shape",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="6.5" stroke="var(--success)" strokeWidth="1.5" />
        <path d="M6 9l2 2 4-4" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    label: "Data Health",
    desc: "Nulls, outliers & cardinality",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 15l4-5 3 3 5-7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14" cy="4" r="2" fill="var(--accent)" opacity="0.3" />
        <circle cx="14" cy="4" r="1" fill="var(--accent)" />
      </svg>
    ),
    label: "Model Advisor",
    desc: "Ranked ML recommendations",
  },
];

export default function UploadPage() {
  const router = useRouter();
  const [animIn, setAnimIn] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setAnimIn(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(null); }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) { setFile(e.target.files[0]); setError(null); }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      router.push(`/workspace?id=${data.dataset_id}&name=${encodeURIComponent(file.name)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  };

  const fmtSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
      : (bytes / 1024).toFixed(1) + " KB";

  const ease = "transition-all duration-500 ease-out";
  const visible = animIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4";

  return (
    <div className="min-h-[calc(100vh-52px)] bg-bg flex flex-col items-center justify-center px-6 py-6">
      <div className="w-full max-w-[680px] flex flex-col items-center">

        {/* Badge */}
        <div className={`${ease} ${visible} mb-6 flex items-center gap-1.5
                          bg-surface border border-border rounded-full px-3.5 py-1.5`}
          style={{ transitionDelay: "0ms" }}>
          <span className="w-1.5 h-1.5 rounded-full inline-block flex-none"
            style={{ background: "var(--accent)" }} />
          <span className="font-dm-mono text-[11px] text-text-muted uppercase tracking-[0.04em]">
            Analysis Workspace
          </span>
        </div>

        {/* Headline */}
        <div className={`${ease} ${visible} text-center mb-8`}
          style={{ transitionDelay: "80ms" }}>
          <h1 className="font-dm-sans font-bold text-text-primary leading-[1.1] tracking-[-0.035em]"
            style={{ fontSize: "clamp(32px,5vw,52px)" }}>
            Drop your dataset.<br />
            <span style={{ color: "var(--accent)" }}>Get instant insights.</span>
          </h1>
        </div>

        <div className={`${ease} ${visible} text-center mb-6`}
          style={{ transitionDelay: "140ms" }}>
          <p className="font-dm-sans text-[16px] text-text-muted leading-relaxed max-w-[420px]">
            Automated EDA, health scoring, and model recommendations — all from a single CSV or Parquet file.
          </p>
        </div>

        {/* Dropzone */}
        <div className={`${ease} ${visible} w-full mb-8`}
          style={{ transitionDelay: "200ms" }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={file ? undefined : () => inputRef.current?.click()}
            className={`relative rounded-2xl p-6 flex flex-col items-center gap-3
                       transition-all duration-200 ${dragOver ? "dropzone-active" : ""}`}
            style={{
              border: `1.5px dashed ${dragOver ? "var(--accent)" : file ? "var(--success)" : "var(--border-strong)"}`,
              background: dragOver ? "var(--accent-soft)" : file ? "var(--success-soft)" : "var(--surface)",
              cursor: file ? "default" : "pointer",
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.parquet,.xlsx,.json"
              aria-label="Upload dataset file"
              className="hidden"
              onChange={handleFileChange}
            />

            {file ? (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center
                             rounded-md text-text-muted bg-surface-raised border border-border
                             hover:text-text-primary transition-all cursor-pointer font-dm-mono
                             text-lg leading-none"
                >×</button>

                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none"
                  style={{ background: "var(--success)" }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M5 11.5l4 4 8-8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <div className="font-dm-mono text-[14px] font-semibold"
                    style={{ color: "var(--success)" }}>
                    {file.name}
                  </div>
                  <div className="font-dm-sans text-[12px] text-text-muted mt-1">
                    {fmtSize(file.size)} · Ready to analyze
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-none
                                border border-border bg-surface-raised transition-all duration-200"
                  style={{ color: dragOver ? "var(--accent)" : "var(--text-muted)" }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M11 3v12M6 8l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
                    <path d="M3 17v2h16v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
                  </svg>
                </div>
                <div className="text-center">
                  <div className="font-dm-sans text-[15px] font-semibold text-text-primary">
                    {dragOver ? "Release to upload" : "Drop your file here"}
                  </div>
                  <div className="font-dm-sans text-[13px] text-text-muted mt-1">
                    CSV, Parquet, Excel or JSON · up to 100 MB
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {error && (
          <p className="mb-2 w-full font-dm-sans text-[13px] text-danger">{error}</p>
        )}

        {/* CTA */}
        <div className={`${ease} ${visible} w-full mb-8`}
          style={{ transitionDelay: "260ms" }}>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!file || uploading}
            className="w-full rounded-[10px] py-3.5 px-6 font-dm-sans font-semibold text-[15px]
                       flex items-center justify-center gap-2 transition-all duration-200
                       tracking-[-0.01em] border-0 cursor-pointer"
            style={{
              background: file && !uploading ? "var(--accent)" : "var(--surface-raised)",
              color: file && !uploading ? "white" : "var(--text-muted)",
              border: file && !uploading ? "none" : "1px solid var(--border)",
              cursor: file && !uploading ? "pointer" : "not-allowed",
            }}
          >
            {uploading ? "Uploading…" : "Analyze Dataset"}
            {!uploading && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h10M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Feature chips */}
        <div className={`${ease} ${visible} flex gap-6 flex-wrap justify-center`}
          style={{ transitionDelay: "320ms" }}>
          {FEATURES.map((f) => (
            <div key={f.label}
              className="flex items-center gap-3 bg-surface border border-border
                            rounded-[10px] px-4 py-3 card-hover">
              {f.icon}
              <div>
                <div className="font-dm-sans text-[12px] font-semibold text-text-primary">
                  {f.label}
                </div>
                <div className="font-dm-sans text-[11px] text-text-muted">
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
