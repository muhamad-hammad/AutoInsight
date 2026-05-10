"use client";

import type { Progress, ProfileStatus } from "@/hooks/useProfile";

const STAGES = [
  { key: "loading",       label: "Loading"    },
  { key: "preprocessing", label: "Preprocessing" },
  { key: "stats",         label: "Statistics" },
  { key: "llm_insight",   label: "Insights"   },
];

interface Props {
  progress: Progress | null;
  status: ProfileStatus;
}

export default function ProgressBar({ progress, status }: Props) {
  if (status === "idle") return null;

  const currentKey = status === "done" ? "done" : (progress?.stage ?? "loading");
  const currentIdx = status === "done"
    ? STAGES.length
    : Math.max(0, STAGES.findIndex((s) => s.key === currentKey));
  const pct = status === "done" ? 100 : (progress?.pct ?? 0);

  return (
    <div data-testid="progress-bar" className="w-full mb-4">
      {/* Stage stepper */}
      <div className="flex items-start mb-6">
        {STAGES.map((stage, i) => {
          const done    = i < currentIdx || status === "done";
          const active  = i === currentIdx && status !== "done";
          const pending = !done && !active;

          return (
            <div key={stage.key} className="flex items-start flex-1 last:flex-none">
              {/* Circle + label */}
              <div className="flex flex-col items-center gap-1.5 flex-none">
                <div className={[
                  "w-7 h-7 rounded-full flex items-center justify-center",
                  "font-dm-mono text-[11px] font-medium",
                  "border-2 transition-all duration-300",
                  done
                    ? "bg-success border-success text-white"
                    : active
                    ? "bg-accent border-accent text-white shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)]"
                    : "bg-surface border-border text-text-faint",
                ].join(" ")}>
                  {done ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span className={[
                  "font-dm-sans text-[11px] whitespace-nowrap",
                  done || active ? "text-text-muted" : "text-text-faint",
                ].join(" ")}>
                  {stage.label}
                </span>
              </div>

              {/* Connector line — between steps */}
              {i < STAGES.length - 1 && (
                <div className="flex-1 mt-3.5 mx-1.5">
                  <div className="h-0.5 bg-border rounded-full overflow-hidden">
                    <div
                      className={`fill-w h-full bg-success rounded-full transition-all duration-500`}
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
          className={[
            "fill-w h-full rounded-full transition-all duration-500",
            status === "error" ? "bg-danger" : "bg-accent",
          ].join(" ")}
          style={{ "--w": `${pct}%` } as React.CSSProperties}
        />
      </div>

      {status === "error" && (
        <p className="mt-2 font-dm-sans text-[13px] text-danger">
          Profiling failed.
        </p>
      )}
    </div>
  );
}
