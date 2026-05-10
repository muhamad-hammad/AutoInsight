"use client";

import { useEffect, useState } from "react";
import type { ModelRoadmap } from "@/lib/types";

interface Props {
  datasetId: string;
  targetCol: string;
}

export default function RoadmapCard({ datasetId, targetCol }: Props) {
  const [roadmaps, setRoadmaps] = useState<ModelRoadmap[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied]     = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset_id: datasetId, target_col: targetCol }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Recommend failed (${r.status})`);
        return r.json() as Promise<ModelRoadmap[]>;
      })
      .then((data) => setRoadmaps(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [datasetId, targetCol]);

  const handleCopy = async (snippet: string, rank: number) => {
    await navigator.clipboard.writeText(snippet);
    setCopied(rank);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading)
    return (
      <div data-testid="roadmap-card"
        className="font-dm-sans text-[13px] text-text-muted flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-accent/40 animate-pulse inline-block" />
        Generating model recommendations…
      </div>
    );

  if (error)
    return (
      <div data-testid="roadmap-card"
        className="font-dm-sans text-[13px] text-danger">{error}</div>
    );

  return (
    <div data-testid="roadmap-card" className="space-y-5">
      <h2 className="font-dm-mono text-[13px] font-medium text-text-muted">
        Recommended models for{" "}
        <span className="text-accent">{targetCol}</span>
      </h2>

      {roadmaps.map((rm) => (
        <RoadmapRow
          key={rm.rank}
          rm={rm}
          expanded={expanded === rm.rank}
          copied={copied === rm.rank}
          onToggle={() => setExpanded((e) => (e === rm.rank ? null : rm.rank))}
          onCopy={() => handleCopy(rm.keras_snippet, rm.rank)}
        />
      ))}
    </div>
  );
}

function RoadmapRow({
  rm, expanded, copied, onToggle, onCopy,
}: {
  rm: ModelRoadmap;
  expanded: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const conf     = rm.confidence * 100;
  const confColor = conf >= 90 ? "var(--success)" : conf >= 70 ? "var(--accent)" : "var(--warning)";
  const arc      = (conf / 100) * 100; /* used as strokeDasharray value out of 100 */

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden card-hover">
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left
                   hover:bg-surface-raised transition-colors cursor-pointer
                   border-0 bg-transparent"
        onClick={onToggle}
      >
        {/* Rank chip */}
        <span className="flex-none w-7 h-7 rounded-full bg-accent-soft border border-accent/20
                         font-dm-mono text-[11px] font-bold text-accent
                         flex items-center justify-center">
          {rm.rank}
        </span>

        {/* Name + summary */}
        <div className="flex-1 min-w-0">
          <p className="font-dm-mono text-[13px] font-medium text-text-primary truncate">
            {rm.model_type}
          </p>
          <p className="font-dm-sans text-[12px] text-text-muted truncate">
            {rm.architecture_summary}
          </p>
        </div>

        {/* Confidence arc badge */}
        <div className="flex-none flex flex-col items-center gap-0.5 mr-1">
          <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
            <circle cx="18" cy="18" r="14" fill="none"
              stroke="var(--border)" strokeWidth="3" />
            <circle cx="18" cy="18" r="14" fill="none"
              stroke={confColor} strokeWidth="3"
              strokeDasharray={`${(arc / 100) * 87.96} 87.96`}
              strokeLinecap="round" />
          </svg>
          <span className="font-dm-mono text-[10px] text-text-muted tabular -mt-0.5">
            {conf.toFixed(0)}%
          </span>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-text-faint transition-transform duration-200 flex-none ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          <p className="font-dm-sans text-[13px] text-text-primary leading-relaxed">
            {rm.rationale}
          </p>

          {rm.keras_layers.length > 0 && (
            <div>
              <p className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
                Architecture
              </p>
              <ul className="space-y-1">
                {rm.keras_layers.map((layer, i) => (
                  <li key={i} className="flex gap-2 font-dm-mono text-[12px] text-text-muted">
                    <span className="text-text-faint flex-none">→</span>
                    {layer}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rm.keras_snippet && (
            <div>
              {/* VS Code-style editor panel */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2
                                bg-surface-raised border-b border-border">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-danger/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-warning/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-success/60" />
                    </div>
                    <span className="font-dm-mono text-[11px] text-text-faint ml-1">
                      model.py
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="keras-snippet"
                    onClick={onCopy}
                    className="font-dm-mono text-[11px] px-2.5 py-1 rounded-md border border-border
                               bg-surface text-text-muted hover:text-text-primary hover:border-accent/40
                               transition-all cursor-pointer flex items-center gap-1.5"
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
                <div className="bg-code-bg p-4 overflow-auto max-h-64">
                  <pre className="font-fira text-[12px] leading-relaxed m-0 whitespace-pre-wrap break-words text-[#ABB2BF]">
                    <code>{rm.keras_snippet}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
