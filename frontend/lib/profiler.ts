/**
 * Pure TypeScript data profiler.
 *
 * Replaces the Python profiler (pandas + tensorflow) with lightweight
 * statistical computations that run in a Vercel serverless function.
 */

import Papa from "papaparse";
import type { DataProfile, FeatureStat } from "./types";

const CORR_THRESHOLD = 0.85;

interface ParsedData {
  columns: string[];
  rows: Record<string, string | number | null>[];
}

/** Parse raw CSV text into typed rows. */
export function parseCSV(csvText: string): ParsedData {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // we do our own typing below
  });

  const columns = result.meta.fields ?? [];
  const rows: Record<string, string | number | null>[] = result.data.map(
    (rawRow) => {
      const row: Record<string, string | number | null> = {};
      for (const col of columns) {
        const v = rawRow[col]?.trim() ?? "";
        if (
          v === "" ||
          ["nan", "null", "none", "na", "n/a"].includes(v.toLowerCase())
        ) {
          row[col] = null;
        } else {
          const asInt = parseInt(v, 10);
          if (!isNaN(asInt) && String(asInt) === v) {
            row[col] = asInt;
          } else {
            const asFloat = parseFloat(v);
            if (!isNaN(asFloat)) {
              row[col] = asFloat;
            } else {
              row[col] = v;
            }
          }
        }
      }
      return row;
    }
  );

  return { columns, rows };
}

/** Determine if a column is numeric based on its values. */
function isNumericColumn(
  rows: Record<string, string | number | null>[],
  col: string
): boolean {
  let numericCount = 0;
  let totalNonNull = 0;
  for (const row of rows) {
    const v = row[col];
    if (v === null) continue;
    totalNonNull++;
    if (typeof v === "number") numericCount++;
  }
  // Consider numeric if ≥80% of non-null values are numbers
  return totalNonNull > 0 && numericCount / totalNonNull >= 0.8;
}

/** Infer a simple dtype string for a column. */
export function inferDtype(
  rows: Record<string, string | number | null>[],
  col: string
): string {
  if (!isNumericColumn(rows, col)) return "object";
  // Check if integer or float
  let hasFloat = false;
  for (const row of rows) {
    const v = row[col];
    if (v === null || typeof v !== "number") continue;
    if (!Number.isInteger(v)) {
      hasFloat = true;
      break;
    }
  }
  return hasFloat ? "float64" : "int64";
}

/** Compute mean of a numeric array (skipping NaN/null). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Compute sample variance. */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSq = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return sumSq / (values.length - 1);
}

/** Compute Pearson correlation between two arrays of equal length. */
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let sumAB = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sumAB += da * db;
    sumA2 += da * da;
    sumB2 += db * db;
  }
  const denom = Math.sqrt(sumA2 * sumB2);
  return denom === 0 ? 0 : sumAB / denom;
}

/**
 * Profile a dataset from raw CSV text.
 *
 * Returns a DataProfile matching the shape expected by the frontend.
 */
export function profileDataset(
  datasetId: string,
  csvText: string
): DataProfile {
  const { columns, rows } = parseCSV(csvText);
  const rowCount = rows.length;

  // Classify columns
  const numericCols: string[] = [];
  const catCols: string[] = [];
  for (const col of columns) {
    if (isNumericColumn(rows, col)) {
      numericCols.push(col);
    } else {
      catCols.push(col);
    }
  }

  // Extract numeric column values (for correlation)
  const numericValues: Record<string, number[]> = {};
  for (const col of numericCols) {
    numericValues[col] = [];
  }

  // We need aligned arrays for correlation — only rows where all numeric cols are non-null
  // But for per-column stats we use all available values
  const perColValues: Record<string, number[]> = {};
  for (const col of numericCols) {
    perColValues[col] = [];
    for (const row of rows) {
      const v = row[col];
      if (v !== null && typeof v === "number" && !isNaN(v)) {
        perColValues[col].push(v);
      }
    }
  }

  // For correlation, use pairwise complete observations
  const corrDict: Record<string, Record<string, number>> = {};
  const highCorrMap: Record<string, string[]> = {};
  for (const col of numericCols) {
    highCorrMap[col] = [];
  }

  if (numericCols.length >= 2) {
    for (const fi of numericCols) {
      const rowD: Record<string, number> = {};
      for (const fj of numericCols) {
        if (fi === fj) {
          rowD[fj] = 1.0;
          continue;
        }
        // Pairwise complete: only rows where both fi and fj are numeric
        const aVals: number[] = [];
        const bVals: number[] = [];
        for (const row of rows) {
          const a = row[fi];
          const b = row[fj];
          if (
            a !== null &&
            typeof a === "number" &&
            !isNaN(a) &&
            b !== null &&
            typeof b === "number" &&
            !isNaN(b)
          ) {
            aVals.push(a);
            bVals.push(b);
          }
        }
        const r = pearson(aVals, bVals);
        const rounded = Math.round(r * 1e6) / 1e6;
        rowD[fj] = isNaN(rounded) ? 0 : rounded;
        if (Math.abs(rounded) > CORR_THRESHOLD) {
          highCorrMap[fi].push(fj);
        }
      }
      corrDict[fi] = rowD;
    }
  }

  // Build feature stats
  const features: FeatureStat[] = [];

  for (const col of numericCols) {
    const vals = perColValues[col];
    const nullCount = rows.filter((r) => {
      const v = r[col];
      return v === null || (typeof v === "number" && isNaN(v));
    }).length;
    const nullPct =
      rowCount > 0
        ? Math.round((nullCount / rowCount) * 100 * 10000) / 10000
        : 0;

    features.push({
      name: col,
      dtype: "float32",
      mean: vals.length > 0 ? mean(vals) : null,
      variance: vals.length > 1 ? variance(vals) : null,
      min_val: vals.length > 0 ? Math.min(...vals) : null,
      max_val: vals.length > 0 ? Math.max(...vals) : null,
      null_count: nullCount,
      null_pct: nullPct,
      cardinality: null,
      high_correlation: highCorrMap[col] ?? [],
    });
  }

  for (const col of catCols) {
    const nullCount = rows.filter((r) => r[col] === null).length;
    const nullPct =
      rowCount > 0
        ? Math.round((nullCount / rowCount) * 100 * 10000) / 10000
        : 0;
    const unique = new Set(
      rows.map((r) => r[col]).filter((v) => v !== null)
    );

    features.push({
      name: col,
      dtype: "int64",
      mean: null,
      variance: null,
      min_val: null,
      max_val: null,
      null_count: nullCount,
      null_pct: nullPct,
      cardinality: unique.size,
      high_correlation: [],
    });
  }

  return {
    dataset_id: datasetId,
    row_count: rowCount,
    feature_count: features.length,
    features,
    correlation_matrix: corrDict,
    narrative: "",
    computed_at: new Date().toISOString(),
  };
}

/**
 * Generate an LLM narrative from a profile.
 */
export async function generateNarrative(
  profile: DataProfile,
  llmProvider?: string | null,
  llmKey?: string | null
): Promise<string> {
  const { chatCompletion, resolveProvider } = await import("./llm");

  const lines: string[] = [];
  for (const f of profile.features) {
    if (f.dtype === "float32" || f.dtype === "float64") {
      const parts = [`null_pct=${f.null_pct}%`];
      if (f.mean != null) {
        parts.unshift(
          `mean=${f.mean.toFixed(4)}`,
          `var=${(f.variance ?? 0).toFixed(4)}`,
          `min=${(f.min_val ?? 0).toFixed(4)}`,
          `max=${(f.max_val ?? 0).toFixed(4)}`
        );
      }
      lines.push(`${f.name}: ${parts.join(", ")}`);
    } else {
      lines.push(
        `${f.name}: cardinality≈${f.cardinality}, null_pct=${f.null_pct}%`
      );
    }
  }

  const highCorrPairs: string[] = [];
  for (const [a, row] of Object.entries(profile.correlation_matrix)) {
    for (const [b, r] of Object.entries(row)) {
      if (a < b && Math.abs(r) > 0.85) {
        highCorrPairs.push(`${a} ↔ ${b}`);
      }
    }
  }

  let prompt =
    `Dataset has ${profile.row_count} rows and ${profile.feature_count} features.\n` +
    "Feature summary:\n" +
    lines.join("\n");

  if (highCorrPairs.length > 0) {
    prompt +=
      "\nHighly correlated pairs (|r|>0.85): " + highCorrPairs.join(", ");
  }
  prompt +=
    "\n\nWrite a short paragraph (3-5 sentences) for a data analyst " +
    "summarising data quality, notable distributions, and any correlation warnings.";

  const provider = resolveProvider(llmProvider, llmKey);
  const result = await chatCompletion(
    [{ role: "user", content: prompt }],
    { provider, maxTokens: 300, temperature: 0.3 }
  );

  return result ?? "";
}
