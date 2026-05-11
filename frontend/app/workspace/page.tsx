"use client";

import { Suspense } from "react";
import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";
import { getCachedCSV } from "@/lib/csv-cache";
import type { DataProfile, FeatureStat } from "@/lib/types";

const NAV_ITEMS = [
  { id: "overview",     label: "Overview"     },
  { id: "features",     label: "Features"     },
  { id: "correlations", label: "Correlations" },
  { id: "health",       label: "Data Health"  },
];

const DTYPE_STYLES: Record<string, { bg: string; text: string }> = {
  float32:  { bg: "var(--accent-soft)",   text: "var(--accent)"   },
  float64:  { bg: "var(--accent-soft)",   text: "var(--accent)"   },
  int32:    { bg: "var(--success-soft)",  text: "var(--success)"  },
  int64:    { bg: "var(--success-soft)",  text: "var(--success)"  },
  string:   { bg: "var(--warning-soft)",  text: "var(--warning)"  },
  object:   { bg: "var(--warning-soft)",  text: "var(--warning)"  },
  boolean:  { bg: "rgba(91,33,182,0.08)", text: "#7C3AED"         },
  datetime: { bg: "var(--danger-soft)",   text: "var(--danger)"   },
};

const STAGE_LABELS: Record<string, string> = {
  loading:       "Loading dataset",
  preprocessing: "Preprocessing",
  stats:         "Computing statistics",
  llm_insight:   "Generating insights",
  done:          "Complete",
};

function computeHealthScore(profile: DataProfile): number {
  if (!profile.features.length) return 100;
  const avgNull = profile.features.reduce((s, f) => s + f.null_pct, 0) / profile.features.length;
  const highCorrCount = profile.features.reduce((s, f) => s + (f.high_correlation?.length ?? 0), 0);
  return Math.max(0, Math.round(100 - avgNull * 2 - highCorrCount * 2));
}

/* ── Loading stepper stages ─────────────────────────────────────────────────── */
const LOAD_STAGES = [
  { key: "loading",       label: "Load"   },
  { key: "preprocessing", label: "Prep"   },
  { key: "stats",         label: "Stats"  },
  { key: "llm_insight",   label: "Insights" },
];

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-52px)] bg-bg" />}>
      <WorkspacePageInner />
    </Suspense>
  );
}

function WorkspacePageInner() {
  const params    = useSearchParams();
  const router    = useRouter();
  const id        = params.get("id");
  const name      = params.get("name") ?? "Dataset";
  const [activeNav, setActiveNav] = useState("overview");
  const [targetCol, setTargetCol] = useState<string | null>(null);

  const { progress, profile, status, error } = useProfile(id);

  if (!id) {
    return (
      <div className="min-h-[calc(100vh-48px)] bg-bg flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="font-dm-mono text-[13px] text-text-muted">No dataset loaded.</div>
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

  const healthScore = profile ? computeHealthScore(profile) : null;
  const pct         = status === "done" ? 100 : (progress?.pct ?? 0);
  const stage       = progress?.stage ?? "loading";
  const stageIdx    = LOAD_STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="flex min-h-[calc(100vh-48px)] bg-bg">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-none bg-surface border-r border-border
                        flex flex-col sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto">
        {/* Dataset name */}
        <div className="px-4 pt-5 pb-4">
          <div className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-1.5">
            Dataset
          </div>
          <div className="font-dm-mono text-[13px] font-medium text-text-primary
                          leading-snug break-all">
            {name}
          </div>
          {profile && (
            <div className="font-dm-sans text-[12px] text-text-muted mt-1">
              {profile.row_count.toLocaleString()} rows ·{" "}
              {profile.feature_count} cols
            </div>
          )}
        </div>

        <div className="h-px bg-border mx-0" />

        {/* Nav */}
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.id}
              label={item.label}
              active={activeNav === item.id}
              disabled={status !== "done"}
              onClick={() => status === "done" && setActiveNav(item.id)}
            />
          ))}
        </nav>

        {/* Footer: health + advisor CTA */}
        <div className="border-t border-border p-4 space-y-4">
          {healthScore !== null ? (
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span
                  className="font-dm-mono text-[28px] font-medium leading-none tabular"
                  style={{
                    color: healthScore >= 80
                      ? "var(--success)"
                      : healthScore >= 60
                      ? "var(--warning)"
                      : "var(--danger)",
                  }}
                >
                  {healthScore}
                </span>
                <span className="font-dm-mono text-[10px] text-text-faint uppercase tracking-wider">
                  / 100
                </span>
              </div>
              <div className="font-dm-mono text-[10px] text-text-faint uppercase tracking-wider mb-2">
                Health Score
              </div>
              <div className="h-1 bg-surface-raised rounded-full overflow-hidden">
                <div
                  className="fill-w h-full rounded-full transition-all duration-700"
                  style={{
                    "--w": `${healthScore}%`,
                    background: healthScore >= 80
                      ? "var(--success)"
                      : healthScore >= 60
                      ? "var(--warning)"
                      : "var(--danger)",
                  } as React.CSSProperties}
                />
              </div>
            </div>
          ) : (
            <div className="font-dm-mono text-[10px] text-text-faint uppercase tracking-wider">
              Health Score
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (!id || !targetCol) return;
              router.push(
                `/advisor?id=${id}&name=${encodeURIComponent(name)}&target=${encodeURIComponent(targetCol)}`
              );
            }}
            disabled={!profile || !targetCol}
            title={!targetCol ? "Click a feature name to set the target column" : undefined}
            className={[
              "w-full h-8 rounded-lg font-dm-mono text-[12px]",
              "border transition-all duration-150",
              profile && targetCol
                ? "border-accent bg-accent-soft text-accent cursor-pointer hover:bg-accent hover:text-white"
                : "border-border bg-surface-raised text-text-faint cursor-not-allowed opacity-50",
            ].join(" ")}
          >
            Model Advisor →
          </button>

          {profile && !targetCol && (
            <p className="font-dm-sans text-[11px] text-text-faint leading-snug">
              Click a feature to set target column
            </p>
          )}
        </div>
      </aside>

      {/* ── Main canvas ──────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 px-10 py-8">
        {/* Loading stepper */}
        {(status === "loading" || status === "idle") && (
          <div className="mb-8">
            <div className="flex items-start mb-5">
              {LOAD_STAGES.map((s, i) => {
                const done   = i < stageIdx;
                const active = i === stageIdx;
                return (
                  <div key={s.key} className="flex items-start flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1.5 flex-none">
                      <div className={[
                        "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                        "font-dm-mono text-[10px] font-medium transition-all duration-300",
                        done
                          ? "bg-success border-success text-white"
                          : active
                          ? "bg-accent border-accent text-white"
                          : "bg-surface border-border text-text-faint",
                      ].join(" ")}>
                        {done ? (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2.5"
                            strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <span>{i + 1}</span>
                        )}
                      </div>
                      <span className={[
                        "font-dm-sans text-[10px] whitespace-nowrap",
                        done || active ? "text-text-muted" : "text-text-faint",
                      ].join(" ")}>
                        {s.label}
                      </span>
                    </div>
                    {i < LOAD_STAGES.length - 1 && (
                      <div className="flex-1 mt-3 mx-1">
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

            <div className="font-dm-mono text-[12px] text-text-muted mb-2">
              {STAGE_LABELS[stage] ?? stage}…
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className="fill-w h-full bg-accent rounded-full transition-all duration-500"
                style={{ "--w": `${pct}%` } as React.CSSProperties}
              />
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="mb-4 p-3 bg-danger-soft border border-danger/20 rounded-lg
                          font-dm-sans text-[13px] text-danger">
            {error ?? "Profiling failed."}
          </div>
        )}

        {status === "done" && profile && (
          <>
            {/* Horizontal tab nav */}
            <div className="flex items-center gap-6 border-b border-border mb-8">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={[
                    "tab-item pb-3 font-dm-sans text-[14px] border-0 bg-transparent cursor-pointer transition-colors",
                    activeNav === item.id
                      ? "active text-text-primary font-semibold"
                      : "text-text-muted hover:text-text-primary",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {activeNav === "overview"     && <OverviewSection    profile={profile} onSelectTarget={setTargetCol} targetCol={targetCol} />}
            {activeNav === "features"     && <FeaturesSection    profile={profile} onSelectTarget={setTargetCol} targetCol={targetCol} />}
            {activeNav === "correlations" && <CorrelationSection profile={profile} />}
            {activeNav === "health"       && <HealthSection      profile={profile} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ── Sidebar link ────────────────────────────────────────────────────────────── */
function SidebarLink({
  label, active, disabled, onClick,
}: {
  label: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={[
        "sidebar-item flex items-center px-4 py-2.5 gap-3 select-none",
        "font-dm-sans text-[13px] transition-all duration-120",
        active
          ? "active bg-accent-soft text-accent font-medium pl-[18px]"
          : disabled
          ? "text-text-faint cursor-default opacity-50"
          : "text-text-muted cursor-pointer hover:bg-surface-raised hover:text-text-primary",
      ].join(" ")}
    >
      {label}
    </div>
  );
}

/* ── Section header ──────────────────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-4">
      {children}
    </div>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────────── */
function OverviewSection({
  profile, onSelectTarget, targetCol,
}: {
  profile: DataProfile; onSelectTarget: (col: string) => void; targetCol: string | null;
}) {
  const avgNull = profile.features.length
    ? (profile.features.reduce((s, f) => s + f.null_pct, 0) / profile.features.length).toFixed(1) + "%"
    : "—";
  const healthScore = computeHealthScore(profile);
  const numericCount = profile.features.filter(
    (f) => f.dtype === "int32" || f.dtype === "int64" || f.dtype === "float32" || f.dtype === "float64"
  ).length;
  const catCount = profile.feature_count - numericCount;

  const stats = [
    { label: "Rows",          value: profile.row_count.toLocaleString(), sub: "observations" },
    { label: "Columns",       value: profile.feature_count.toString(),   sub: "features"     },
    { label: "Health Score",  value: healthScore.toString(),             sub: "/ 100", accent: true },
    { label: "Missing",       value: avgNull,                            sub: "of cells"     },
    { label: "Numeric",       value: numericCount.toString(),            sub: "columns"      },
    { label: "Categorical",   value: catCount.toString(),                sub: "columns"      },
  ];

  return (
    <div>
      <SectionTitle>Overview</SectionTitle>

      {/* Stat grid — 3 col matching design */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        {stats.map((s, i) => (
          <div
            key={i}
            className={`fade-up-${i + 1} bg-surface border border-border rounded-xl
                        px-6 py-6 transition-all duration-150 flex flex-col gap-1`}
          >
            <div className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint mb-1">
              {s.label}
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="font-dm-sans font-bold text-[26px] leading-none tabular tracking-[-0.03em]"
                style={{ color: s.accent ? "var(--accent)" : "var(--text-primary)" }}
              >
                {s.value}
              </span>
              {s.sub && (
                <span className="font-dm-mono text-[12px] text-text-muted">{s.sub}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* AI Narrative with badge */}
      {profile.narrative && (
        <div className="mb-10">
          <div className="bg-surface border border-border rounded-xl px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-[5px] flex items-center justify-center flex-none"
                   style={{ background: "var(--accent)" }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M2 8.5l2.5-3 2 2 3-4.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="font-dm-sans font-semibold text-[13px] text-text-primary">AI Insight</span>
              <span className="font-dm-mono text-[10px] text-text-muted bg-surface-raised
                               border border-border rounded-[4px] px-1.5 py-px">
                auto-generated
              </span>
            </div>
            <p className="font-dm-sans text-[14px] text-text-muted leading-relaxed m-0">
              {profile.narrative}
            </p>
          </div>
        </div>
      )}

      {/* Data preview */}
      <div className="flex items-center justify-between mb-6">
        <SectionTitle>Data Preview</SectionTitle>
        <span className="font-dm-mono text-[11px] text-text-faint">6 random rows</span>
      </div>
      <PreviewHint targetCol={targetCol} />
      <DataPreviewTable
        datasetId={profile.dataset_id}
        onSelectTarget={onSelectTarget}
        targetCol={targetCol}
      />
    </div>
  );
}

function PreviewHint({ targetCol }: { targetCol: string | null }) {
  if (targetCol) {
    return (
      <div className="mb-2 font-dm-sans text-[12px] text-success flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Target: <strong>{targetCol}</strong> — click "Model Advisor →" in the sidebar.
      </div>
    );
  }
  return (
    <div className="mb-2 font-dm-sans text-[12px] text-text-muted">
      Click a column header to select it as the target column for model recommendations.
    </div>
  );
}

/* ── Data preview table ──────────────────────────────────────────────────────── */
function DataPreviewTable({
  datasetId, onSelectTarget, targetCol,
}: {
  datasetId: string; onSelectTarget: (col: string) => void; targetCol: string | null;
}) {
  const [rows, setRows]       = useState<Record<string, string | number | null>[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setLoading(true);
    getCachedCSV(datasetId).then(csvContent => {
      return fetch(`/api/preview/${datasetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_content: csvContent || undefined })
      });
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setRows(data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const columns = useMemo(() => (rows.length > 0 ? Object.keys(rows[0]) : []), [rows]);
  const sorted  = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  if (loading)
    return <div className="font-dm-sans text-[13px] text-text-muted">Loading preview…</div>;
  if (rows.length === 0) return null;

  return (
    <div className="border border-border rounded-xl overflow-auto bg-surface shadow-sm">
      <table className="w-full border-collapse" style={{ minWidth: 600 }}>
        <thead>
          <tr className="border-b border-border bg-surface-raised">
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => { onSelectTarget(col); handleSort(col); }}
                title={`Select "${col}" as target`}
                className={[
                  "px-4 py-3 text-left font-dm-mono text-[10px] uppercase tracking-widest",
                  "sticky top-0 cursor-pointer select-none whitespace-nowrap",
                  "transition-colors duration-120",
                  col === targetCol
                    ? "text-accent bg-accent-soft"
                    : "text-text-faint hover:text-text-muted bg-surface-raised",
                ].join(" ")}
              >
                {col}
                {sortCol === col && (
                  <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className={[
                "border-b border-border-subtle transition-colors duration-80",
                i % 2 === 1 ? "bg-surface-raised/40" : "bg-surface",
                "hover:bg-accent-soft/20",
              ].join(" ")}
            >
              {columns.map((col) => {
                const val    = row[col];
                const isNull = val === null || val === undefined;
                return (
                  <td
                    key={col}
                    className={[
                      "px-4 py-2.5 font-dm-mono text-[12px] whitespace-nowrap tabular",
                      isNull ? "text-text-faint" : "text-text-primary",
                    ].join(" ")}
                  >
                    {isNull ? (
                      <span className="line-through opacity-40 select-none">null</span>
                    ) : (
                      String(val)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Features section ────────────────────────────────────────────────────────── */
function FeaturesSection({
  profile, onSelectTarget, targetCol,
}: {
  profile: DataProfile; onSelectTarget: (col: string) => void; targetCol: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <SectionTitle>Features — {profile.features.length} columns</SectionTitle>
        {!targetCol && (
          <span className="font-dm-sans text-[12px] text-text-muted">
            Click a feature name to set target
          </span>
        )}
      </div>
      <div className="border border-border rounded-xl bg-surface overflow-hidden shadow-sm">
        {/* Header row */}
        <div className="flex items-center gap-4 px-5 py-2.5 bg-surface-raised
                        border-b border-border">
          <span className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint w-36 flex-none">
            Name
          </span>
          <span className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint w-16 flex-none">
            Type
          </span>
          <span className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint flex-1">
            Null %
          </span>
          <span className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint w-16 text-right flex-none">
            Mean
          </span>
          <span className="font-dm-mono text-[10px] uppercase tracking-widest text-text-faint w-16 text-right flex-none">
            Card.
          </span>
          <span className="w-5 flex-none" />
        </div>
        {profile.features.map((feat, i) => (
          <FeatureRow
            key={i}
            feat={feat}
            last={i === profile.features.length - 1}
            isTarget={feat.name === targetCol}
            onSelectTarget={() => onSelectTarget(feat.name)}
          />
        ))}
      </div>
    </div>
  );
}

function FeatureRow({
  feat, last, isTarget, onSelectTarget,
}: {
  feat: FeatureStat; last: boolean; isTarget: boolean; onSelectTarget: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dtype    = DTYPE_STYLES[feat.dtype] ?? DTYPE_STYLES.object;
  const nullColor =
    feat.null_pct === 0 ? "var(--border)"
    : feat.null_pct < 10 ? "var(--text-faint)"
    : feat.null_pct < 30 ? "var(--warning)"
    : "var(--danger)";

  /* Simple approximated bar chart data */
  const BAR_DATA = [18, 32, 41, 55, 62, 48, 37, 25, 19, 14, 9];

  return (
    <div>
      <div
        className={[
          "flex items-center gap-4 px-5 py-3 transition-colors duration-120",
          !last || expanded ? "border-b border-border-subtle" : "",
          isTarget ? "bg-accent-soft" : "hover:bg-surface-raised",
        ].join(" ")}
      >
        {/* Name */}
        <span
          onClick={onSelectTarget}
          title="Select as target column"
          className={[
            "font-dm-mono text-[13px] w-36 flex-none cursor-pointer truncate",
            "hover:underline underline-offset-2 transition-colors",
            isTarget ? "text-accent" : "text-text-primary hover:text-accent",
          ].join(" ")}
        >
          {feat.name}
        </span>

        {/* Type badge */}
        <span
          className="font-dm-mono text-[10px] px-2 py-0.5 rounded-md w-16 flex-none
                     text-center truncate"
          style={{ background: dtype.bg, color: dtype.text }}
        >
          {feat.dtype}
        </span>

        {/* Null bar */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1 bg-border rounded-full relative overflow-hidden">
            <div
              className="fill-w absolute left-0 top-0 h-full rounded-full"
              style={{
                "--w": `${Math.min(feat.null_pct * 3, 100)}%`,
                background: nullColor,
              } as React.CSSProperties}
            />
          </div>
          <span className="font-dm-mono text-[12px] text-text-muted tabular w-10 text-right flex-none">
            {feat.null_pct.toFixed(1)}%
          </span>
        </div>

        {/* Mean */}
        <span className="font-dm-mono text-[12px] text-text-muted tabular w-16 text-right flex-none">
          {feat.mean != null ? feat.mean.toFixed(2) : "—"}
        </span>

        {/* Cardinality */}
        <span className="font-dm-mono text-[12px] text-text-muted tabular w-16 text-right flex-none">
          {feat.cardinality?.toLocaleString() ?? "—"}
        </span>

        {/* Expand toggle */}
        <button
          type="button"
          aria-label={expanded ? "Collapse feature details" : "Expand feature details"}
          onClick={() => setExpanded((e) => !e)}
          className="w-5 h-5 flex items-center justify-center rounded text-text-faint
                     hover:text-text-muted hover:bg-surface-hover
                     transition-all border-0 bg-transparent cursor-pointer flex-none"
        >
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
      </div>

      {/* Expanded distribution */}
      {expanded && (
        <div className={[
          "px-5 py-4 bg-surface-raised",
          last ? "" : "border-b border-border-subtle",
        ].join(" ")}>
          <div className="flex items-end gap-1 h-14">
            {BAR_DATA.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm transition-all duration-200"
                style={{
                  height: `${(v / 62) * 100}%`,
                  background: "var(--accent)",
                  opacity: 0.7 + (v / 62) * 0.3,
                }}
              />
            ))}
          </div>
          <div className="mt-2 font-dm-sans text-[12px] text-text-muted">
            Distribution ·{" "}
            <span className="font-dm-mono">{feat.cardinality?.toLocaleString() ?? "—"}</span>{" "}
            unique values
            {feat.high_correlation?.length
              ? ` · correlated with: ${feat.high_correlation.join(", ")}`
              : ""}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Correlation heatmap ─────────────────────────────────────────────────────── */
function CorrelationSection({ profile }: { profile: DataProfile }) {
  const keys = Object.keys(profile.correlation_matrix);

  if (!keys.length) {
    return (
      <div>
        <SectionTitle>Correlation Heatmap</SectionTitle>
        <div className="font-dm-sans text-[13px] text-text-muted">
          No numeric features found for correlation analysis.
        </div>
      </div>
    );
  }

  /* Blue → surface → red diverging colour scale via CSS color-mix */
  const cellBg = (v: number) =>
    v >= 0
      ? `color-mix(in srgb, var(--accent)  ${Math.round(Math.abs(v) * 75)}%, var(--surface))`
      : `color-mix(in srgb, var(--danger)  ${Math.round(Math.abs(v) * 75)}%, var(--surface))`;

  return (
    <div>
      <SectionTitle>Correlation Heatmap</SectionTitle>

      {/* Legend */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-20 h-2 rounded-full"
          style={{
            background: "linear-gradient(to right, var(--danger), var(--surface), var(--accent))"
          }}
        />
        <span className="font-dm-sans text-[11px] text-text-faint">−1</span>
        <span className="font-dm-sans text-[11px] text-text-faint ml-auto mr-2">0</span>
        <span className="font-dm-sans text-[11px] text-text-faint">+1</span>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 overflow-auto inline-block shadow-sm">
        {/* Column headers */}
        <div className="flex" style={{ paddingLeft: 108 }}>
          {keys.map((k) => (
            <div
              key={k}
              className="font-dm-mono text-[10px] text-text-muted text-center"
              style={{ width: 56, overflow: "hidden", textOverflow: "ellipsis",
                       whiteSpace: "nowrap", padding: "0 2px", marginBottom: 6 }}
            >
              {k}
            </div>
          ))}
        </div>

        {/* Rows */}
        {keys.map((row, ri) => (
          <div key={ri} className="flex items-center mb-1">
            <div
              className="font-dm-mono text-[10px] text-text-muted text-right pr-3"
              style={{ width: 108, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {row}
            </div>
            {keys.map((col, ci) => {
              const v = profile.correlation_matrix[row]?.[col] ?? 0;
              const isHigh = Math.abs(v) > 0.6 && ri !== ci;
              return (
                <div
                  key={ci}
                  title={`${row} × ${col}: ${v.toFixed(3)}`}
                  className="rounded-md flex items-center justify-center relative"
                  style={{
                    width: 54, height: 38,
                    background: cellBg(v),
                    marginRight: 2,
                  }}
                >
                  <span
                    className="font-dm-mono text-[10px] tabular"
                    style={{ color: Math.abs(v) > 0.55 ? "#fff" : "var(--text-muted)" }}
                  >
                    {v.toFixed(2)}
                  </span>
                  {isHigh && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger" />
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <div className="mt-3 flex items-center gap-2 font-dm-sans text-[11px] text-text-faint">
          <span className="w-2 h-2 rounded-full bg-danger inline-block flex-none" />
          Strong correlation flagged (|r| &gt; 0.6)
        </div>
      </div>
    </div>
  );
}

/* ── Health section ──────────────────────────────────────────────────────────── */
function HealthSection({ profile }: { profile: DataProfile }) {
  const highNull = profile.features.filter((f) => f.null_pct >= 5);
  const highCard = profile.features.filter(
    (f) => (f.cardinality ?? 0) > 100 && f.dtype !== "float32" && f.dtype !== "float64"
  );
  const highCorr = profile.features.filter((f) => f.high_correlation?.length > 0);

  const items = [
    {
      label:  "Missing values",
      status: highNull.length === 0
        ? "good"
        : highNull.some((f) => f.null_pct > 20) ? "danger" : "warning",
      detail: highNull.length === 0
        ? "No significant missing values detected."
        : `${highNull.length} feature(s) with ≥5% null — ${highNull.map((f) => `${f.name} (${f.null_pct.toFixed(1)}%)`).join(", ")}`,
    },
    {
      label:  "High cardinality",
      status: highCard.length === 0 ? "good" : "warning",
      detail: highCard.length === 0
        ? "No high-cardinality categorical features."
        : highCard.map((f) => `${f.name} (${f.cardinality?.toLocaleString()} unique)`).join(", "),
    },
    {
      label:  "Correlated features",
      status: highCorr.length === 0 ? "good" : "warning",
      detail: highCorr.length === 0
        ? "No strong inter-feature correlations detected."
        : highCorr.map((f) => `${f.name} ↔ ${f.high_correlation.join(", ")}`).join(" | "),
    },
  ];

  const statusMeta: Record<string, { dot: string; badge: string; badgeBg: string; label: string }> = {
    good:    { dot: "var(--success)", badge: "var(--success)", badgeBg: "var(--success-soft)", label: "Pass" },
    warning: { dot: "var(--warning)", badge: "var(--warning)", badgeBg: "var(--warning-soft)", label: "Warn" },
    danger:  { dot: "var(--danger)",  badge: "var(--danger)",  badgeBg: "var(--danger-soft)",  label: "Fail" },
  };

  return (
    <div>
      <SectionTitle>Data Health Report</SectionTitle>
      <div className="space-y-6">
        {items.map((item, i) => {
          const m = statusMeta[item.status];
          return (
            <div
              key={i}
              className={`fade-up-${i + 1} bg-surface border border-border rounded-xl
                          p-6 flex items-start gap-5 shadow-sm`}
            >
              <div
                className="w-2.5 h-2.5 rounded-full flex-none mt-1"
                style={{ background: m.dot }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-dm-mono text-[13px] text-text-primary mb-0.5">
                  {item.label}
                </div>
                <div className="font-dm-sans text-[12px] text-text-muted leading-snug">
                  {item.detail}
                </div>
              </div>
              <span
                className="font-dm-mono text-[11px] font-medium px-2.5 py-1 rounded-full flex-none"
                style={{ color: m.badge, background: m.badgeBg }}
              >
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
