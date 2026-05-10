"use client";

import { Suspense } from "react";
import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { ModelRoadmap } from "@/lib/types";

const STAGES = [
  "Profiling features",
  "Detecting task type",
  "Scoring model families",
  "Generating recommendations",
];

const NAV_ITEMS = [
  { id: "overview",     label: "Overview"     },
  { id: "features",     label: "Features"     },
  { id: "correlations", label: "Correlations" },
  { id: "health",       label: "Data Health"  },
  { id: "advisor",      label: "Model Advisor", active: true },
];

/* ─── LLM Provider selector ─────────────────────────────────────────────────── */
const PROVIDERS = [
  { id: "openai", name: "OpenAI (GPT-4o mini)" },
  { id: "openrouter", name: "OpenRouter (Llama 3.3)" },
  { id: "gemini", name: "Google Gemini (2.0 Flash)" },
  { id: "grok", name: "xAI Grok (3 mini)" },
  { id: "groq", name: "Groq (Llama 3.3)" },
];

interface LLMProvider { name: string; model: string; configured: boolean; }
interface LLMStatus   { active_provider: string | null; active_model: string | null; providers: LLMProvider[]; }

function LLMSelector() {
  const [status, setStatus] = useState<LLMStatus | null>(null);
  const [open, setOpen]     = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchStatus = () =>
    fetch("/api/llm/status").then((r) => r.json()).then(setStatus).catch(() => {});

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectProvider = async (name: string | null) => {
    setOpen(false);
    await fetch("/api/llm/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: name }),
    });
    fetchStatus();
  };

  const active = localStorage.getItem("ai-llm-provider") || status?.active_provider;
  const model  = active ? PROVIDERS.find(p => p.id === active)?.name.split('(')[1]?.replace(')', '') : status?.active_model;
  const label  = active ? `${active}${model ? ` · ${model}` : ""}` : "No LLM";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex items-center gap-2 font-dm-mono text-[11px]",
          "bg-surface-raised border border-border rounded-lg px-3 py-1.5",
          "cursor-pointer hover:border-accent/40 transition-all",
          active ? "text-success" : "text-text-muted",
        ].join(" ")}
      >
        <span
          className={[
            "w-1.5 h-1.5 rounded-full flex-none",
            active ? "bg-success" : "bg-text-faint",
          ].join(" ")}
        />
        <span className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          className={`flex-none transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && status && (
        <div className="absolute top-[calc(100%+6px)] right-0 z-50
                        bg-surface border border-border rounded-xl min-w-[240px]
                        py-1.5 shadow-[var(--shadow-lg)]">
          <div className="font-dm-mono text-[10px] uppercase tracking-widest
                          text-text-faint px-3.5 pt-1 pb-2">
            LLM Provider
          </div>
          {status.providers.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={!p.configured}
              onClick={() => selectProvider(p.name)}
              className={[
                "w-full flex items-center justify-between px-3.5 py-2",
                "font-dm-mono text-[12px] border-0 bg-transparent",
                "border-l-2 transition-all",
                p.name === active
                  ? "text-accent border-l-accent"
                  : "text-text-primary border-l-transparent",
                p.configured
                  ? "cursor-pointer hover:bg-surface-raised"
                  : "opacity-40 cursor-default",
              ].join(" ")}
            >
              <span>{p.name}</span>
              <span className="font-dm-mono text-[10px] text-text-muted max-w-[130px]
                               overflow-hidden text-ellipsis whitespace-nowrap ml-2">
                {p.configured ? p.model : "no key"}
              </span>
            </button>
          ))}
          {active && (
            <>
              <div className="h-px bg-border mx-2 my-1" />
              <button
                type="button"
                onClick={() => selectProvider(null)}
                className="w-full px-3.5 py-2 text-left font-dm-mono text-[12px]
                           text-text-muted border-0 bg-transparent cursor-pointer
                           hover:bg-surface-raised hover:text-text-primary transition-colors"
              >
                Auto-detect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdvisorPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-52px)] bg-bg" />}>
      <AdvisorPageInner />
    </Suspense>
  );
}

/* ─── Advisor page ───────────────────────────────────────────────────────────── */
function AdvisorPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id     = params.get("id");
  const name   = params.get("name") ?? "Dataset";
  const target = params.get("target");

  const [roadmaps,  setRoadmaps]  = useState<ModelRoadmap[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [progress,  setProgress]  = useState(0);
  const [stageIdx,  setStageIdx]  = useState(0);
  const [animDone,  setAnimDone]  = useState(false);

  /* Simulated progress animation */
  useEffect(() => {
    let p = 0;
    const interval = setInterval(() => {
      p += 1.4;
      setProgress(Math.min(p, 100));
      setStageIdx(Math.min(Math.floor(p / 26), STAGES.length - 1));
      if (p >= 100) { clearInterval(interval); setAnimDone(true); }
    }, 28);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!id || !target) return;
    setLoading(true);
    setError(null);
    const llmProvider = localStorage.getItem("ai-llm-provider");
    const llmKey = localStorage.getItem("ai-llm-key");

    fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        dataset_id: id, 
        target_col: target,
        llm_provider: llmProvider,
        llm_key: llmKey
      }),
    })
      .then((r) => { if (!r.ok) throw new Error(`Recommend failed (${r.status})`); return r.json(); })
      .then((data) => setRoadmaps(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, target]);

  if (!id || !target) {
    return (
      <div className="min-h-[calc(100vh-48px)] bg-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="font-dm-mono text-[13px] text-text-muted">
            No dataset or target column provided.
          </div>
          <button type="button" onClick={() => router.push("/")}
            className="font-dm-mono text-[13px] text-accent border border-accent/40
                       bg-accent-soft rounded-lg px-4 py-2 cursor-pointer
                       hover:border-accent transition-all">
            ← Upload a dataset
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-48px)] bg-bg">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-none bg-surface border-r border-border
                        flex flex-col sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto">
        <div className="px-4 pt-5 pb-4">
          <div className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-1.5">
            Dataset
          </div>
          <div className="font-dm-mono text-[13px] font-medium text-text-primary
                          leading-snug break-all">
            {name}
          </div>
          {target && (
            <div className="font-dm-sans text-[12px] text-text-muted mt-1">
              Target:{" "}
              <span className="font-dm-mono text-accent">{target}</span>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        <nav className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              onClick={() =>
                !item.active && id
                  ? router.push(`/workspace?id=${id}&name=${encodeURIComponent(name)}`)
                  : undefined
              }
              className={[
                "sidebar-item flex items-center px-4 py-2.5 gap-3 select-none",
                "font-dm-sans text-[13px] transition-all duration-120",
                item.active
                  ? "active bg-accent-soft text-accent font-medium pl-[18px]"
                  : "text-text-muted cursor-pointer hover:bg-surface-raised hover:text-text-primary",
              ].join(" ")}
            >
              {item.label}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main canvas ──────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 px-10 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
              Model Advisor
            </div>
            <h1 className="font-dm-mono text-[20px] font-medium text-text-primary leading-tight">
              Recommendations for{" "}
              <span className="text-accent">{target}</span>
            </h1>
          </div>
          <LLMSelector />
        </div>

        {/* ── Stepper progress ────────────────────────────────────────────── */}
        {(loading || !animDone) && (
          <div className="mb-10 max-w-xl">
            <div className="flex items-start mb-5">
              {STAGES.map((stage, i) => {
                const done   = i < stageIdx;
                const active = i === stageIdx;
                return (
                  <div key={i} className="flex items-start flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1.5 flex-none">
                      <div className={[
                        "w-8 h-8 rounded-full border-2 flex items-center justify-center",
                        "font-dm-mono text-[11px] font-medium transition-all duration-300",
                        done
                          ? "bg-success border-success text-white"
                          : active
                          ? "bg-accent border-accent text-white shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_15%,transparent)]"
                          : "bg-surface border-border text-text-faint",
                      ].join(" ")}>
                        {done ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2.5"
                            strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <span>{i + 1}</span>
                        )}
                      </div>
                      <span className={[
                        "font-dm-sans text-[10px] text-center max-w-[64px] leading-tight",
                        done || active ? "text-text-muted" : "text-text-faint",
                      ].join(" ")}>
                        {stage}
                      </span>
                    </div>
                    {i < STAGES.length - 1 && (
                      <div className="flex-1 mt-4 mx-1.5">
                        <div className="h-0.5 bg-border rounded-full overflow-hidden">
                          <div
                            className="fill-w h-full bg-success rounded-full transition-all duration-500"
                            style={{ "--w": done ? "100%" : "0%" } as React.CSSProperties}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className="fill-w h-full bg-accent rounded-full transition-all duration-[28ms] linear"
                style={{ "--w": `${progress}%` } as React.CSSProperties}
              />
            </div>
            <div className="font-dm-mono text-[12px] text-text-muted mt-2">
              {STAGES[stageIdx]}…
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-danger-soft border border-danger/20 rounded-lg
                          font-dm-sans text-[13px] text-danger">
            {error}
          </div>
        )}

        {/* Recommendation cards */}
        {!loading && animDone && roadmaps.length > 0 && (
          <div className="space-y-6">
            {roadmaps.map((rm, i) => (
              <RecommendationCard key={rm.rank} rm={rm} delay={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Recommendation card ────────────────────────────────────────────────────── */
function RecommendationCard({ rm, delay }: { rm: ModelRoadmap; delay: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const conf      = rm.confidence * 100;
  const isTop     = rm.rank === 1;
  /* Arc: circumference of r=15 circle = 2π×15 ≈ 94.25 */
  const arcLen    = 94.25;
  const arcFill   = (conf / 100) * arcLen;
  const confColor =
    conf >= 90 ? "var(--success)"
    : conf >= 70 ? "var(--accent)"
    : "var(--warning)";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(rm.keras_snippet).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={[
        "bg-surface rounded-xl border transition-all duration-150 overflow-hidden",
        "shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
        isTop ? "border-accent/40" : "border-border hover:border-border",
        `fade-up-${Math.min(delay + 1, 6)}`,
      ].join(" ")}
    >
      {/* Top accent bar for rank 1 */}
      {isTop && (
        <div className="h-0.5 bg-gradient-to-r from-accent via-accent/60 to-transparent" />
      )}

      <div className="p-7">
        {/* Card header */}
        <div className="flex items-start gap-5 mb-6">
          {/* Rank chip */}
          <div className="flex-none w-9 h-9 rounded-full bg-accent-soft border border-accent/20
                          font-dm-mono text-[13px] font-bold text-accent
                          flex items-center justify-center shadow-sm">
            {String(rm.rank).padStart(2, "0")}
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-dm-mono text-[16px] font-medium text-text-primary leading-tight">
              {rm.model_type}
            </h3>
            <p className="font-dm-mono text-[12px] text-text-muted mt-0.5">
              {rm.architecture_summary}
            </p>
          </div>

          {/* Confidence arc */}
          <div className="flex-none flex flex-col items-center gap-0.5">
            <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none"
                stroke="var(--border)" strokeWidth="2.5"/>
              <circle cx="18" cy="18" r="15" fill="none"
                stroke={confColor} strokeWidth="2.5"
                strokeDasharray={`${arcFill} ${arcLen}`}
                strokeLinecap="round"
                className="transition-all duration-700"/>
            </svg>
            <span className="font-dm-mono text-[11px] text-text-muted tabular leading-none -mt-0.5">
              {conf.toFixed(0)}%
            </span>
            <span className="font-dm-sans text-[10px] text-text-faint">match</span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-border-subtle mb-6" />

        {/* Rationale */}
        <p className="font-dm-sans text-[13px] text-text-primary leading-relaxed mb-6">
          {rm.rationale}
        </p>

        {/* Architecture layers */}
        {rm.keras_layers?.length > 0 && (
          <div className="mb-6">
            <div className="font-dm-mono text-[10px] uppercase tracking-widest
                            text-text-faint mb-2">
              Architecture
            </div>
            <ul className="space-y-1.5">
              {rm.keras_layers.map((layer, i) => (
                <li key={i} className="flex items-center gap-2 font-dm-mono text-[12px] text-text-muted">
                  <span className="text-text-faint flex-none">→</span>
                  {layer}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Code snippet toggle + VS Code panel */}
        {rm.keras_snippet && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1.5 font-dm-mono text-[12px] text-accent
                         border-0 bg-transparent cursor-pointer hover:opacity-80 p-0 transition-opacity"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
              </svg>
              {expanded ? "Hide code" : "View code"}
            </button>

            <div className={[
              "overflow-hidden transition-all duration-200",
              expanded ? "max-h-[400px] mt-3" : "max-h-0",
            ].join(" ")}>
              {/* VS Code-style panel */}
              <div className="rounded-lg border border-border overflow-hidden">
                {/* Title bar */}
                <div className="flex items-center justify-between px-3 py-2
                                bg-surface-raised border-b border-border">
                  <div className="flex items-center gap-2">
                    {/* Traffic lights */}
                    <div className="flex gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/70" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/70" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/70" />
                    </div>
                    <span className="font-dm-mono text-[11px] text-text-faint ml-1">
                      model.py
                    </span>
                    <span className="font-dm-mono text-[10px] text-text-faint/60 ml-1">
                      · python
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 font-dm-mono text-[11px]
                               px-2.5 py-1 rounded-md border border-border
                               bg-surface text-text-muted cursor-pointer
                               hover:border-accent/40 hover:text-text-primary
                               transition-all"
                  >
                    {copied ? (
                      <>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                          stroke="var(--success)" strokeWidth="2.5"
                          strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>

                {/* Code area */}
                <div className="bg-code-bg overflow-auto max-h-72"
                     style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border-strong) transparent" }}>
                  <pre className="font-fira text-[12px] leading-relaxed m-0 p-4
                                  whitespace-pre text-[#ABB2BF]">
                    {String(rm.keras_snippet ?? "").split("\n").map((line, i) => (
                      <SyntaxLine key={i} line={line} />
                    ))}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Syntax highlighter ─────────────────────────────────────────────────────── */
function SyntaxLine({ line }: { line: string }) {
  if (line.trim().startsWith("#")) {
    return (
      <div>
        <span className="token-comment">{line}</span>{"\n"}
      </div>
    );
  }

  const kwRegex  = /\b(import|from|as|def|class|return|if|else|for|in|True|False|None|and|or|not)\b/g;
  const strRegex = /('[^']*'|"[^"]*")/g;
  const numRegex = /\b(\d+\.?\d*)\b/g;

  const allMatches: { start: number; end: number; type: string; text: string }[] = [];
  let m: RegExpExecArray | null;

  kwRegex.lastIndex  = 0; while ((m = kwRegex.exec(line))  !== null) allMatches.push({ start: m.index, end: m.index + m[0].length, type: "kw",  text: m[0] });
  strRegex.lastIndex = 0; while ((m = strRegex.exec(line)) !== null) allMatches.push({ start: m.index, end: m.index + m[0].length, type: "str", text: m[0] });
  numRegex.lastIndex = 0; while ((m = numRegex.exec(line)) !== null) allMatches.push({ start: m.index, end: m.index + m[0].length, type: "num", text: m[0] });

  allMatches.sort((a, b) => a.start - b.start);
  const deduped: typeof allMatches = [];
  let last = 0;
  for (const tok of allMatches) {
    if (tok.start >= last) { deduped.push(tok); last = tok.end; }
  }

  const result: React.ReactNode[] = [];
  let cur = 0;
  for (const tok of deduped) {
    if (tok.start > cur) result.push(<span key={cur}>{line.slice(cur, tok.start)}</span>);
    const cls =
      tok.type === "kw"  ? "token-keyword" :
      tok.type === "str" ? "token-string"  : "token-number";
    result.push(<span key={tok.start} className={cls}>{tok.text}</span>);
    cur = tok.end;
  }
  if (cur < line.length) result.push(<span key={cur}>{line.slice(cur)}</span>);
  return <div>{result}{"\n"}</div>;
}
