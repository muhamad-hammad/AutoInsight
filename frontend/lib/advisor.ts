/**
 * Model recommendation engine — pure TypeScript port of
 * backend/pipeline/advisor.py.
 *
 * Rule-based architecture selection + optional LLM enrichment.
 */

import type { ModelRoadmap } from "./types";
import { resolveProvider, chatCompletion } from "./llm";

/* ── Snippet templates ───────────────────────────────────────────────────── */

const SNIPPETS: Record<string, string> = {
  deep_mlp: `model = tf.keras.Sequential([
    tf.keras.layers.Dense(256, activation='relu'),
    tf.keras.layers.Dense(128, activation='relu'),
    tf.keras.layers.Dense(64, activation='relu'),
    tf.keras.layers.Dense(1),
])`,
  wide_deep: `wide = tf.keras.layers.concatenate([cat_inputs, num_inputs])
deep = tf.keras.layers.Dense(128, activation='relu')(num_inputs)
deep = tf.keras.layers.Dense(64, activation='relu')(deep)
output = tf.keras.layers.Dense(1, activation='sigmoid')(
    tf.keras.layers.concatenate([wide, deep])
)`,
  emb_mlp: `emb = tf.keras.layers.Embedding(vocab_size, 16)(cat_input)
flat = tf.keras.layers.Flatten()(emb)
x = tf.keras.layers.Dense(128, activation='relu')(
    tf.keras.layers.concatenate([flat, num_input])
)
output = tf.keras.layers.Dense(1)(x)`,
  cnn_1d: `x = tf.keras.layers.Conv1D(64, 3, activation='relu')(seq_input)
x = tf.keras.layers.GlobalMaxPooling1D()(x)
output = tf.keras.layers.Dense(1)(x)`,
  lstm: `x = tf.keras.layers.LSTM(64, return_sequences=False)(seq_input)
output = tf.keras.layers.Dense(1)(x)`,
  shallow_mlp: `model = tf.keras.Sequential([
    tf.keras.layers.Dense(32, activation='relu'),
    tf.keras.layers.Dense(16, activation='relu'),
    tf.keras.layers.Dense(1),
])`,
};

/* ── Feature map types ───────────────────────────────────────────────────── */

export type FeatureRole = "numeric" | "categorical" | "target";

export interface FeatureInfo {
  role: FeatureRole;
  dtype: string;
  cardinality: number | null;
  target_type?: string;
  high_correlation?: string[];
}

export type FeatureMap = Record<string, FeatureInfo>;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function hasHighCardinalityCats(fm: FeatureMap): boolean {
  return Object.values(fm).some(
    (info) =>
      info.role === "categorical" &&
      (info.cardinality === null || info.cardinality > 50)
  );
}

function hasHighCorrelation(fm: FeatureMap): boolean {
  return Object.values(fm).some(
    (info) => info.high_correlation && info.high_correlation.length > 0
  );
}

function roadmap(
  rank: number,
  model_type: string,
  architecture_summary: string,
  keras_layers: string[],
  confidence: number,
  rationale: string,
  keras_snippet: string,
  target_type: string
): ModelRoadmap {
  return {
    rank,
    model_type,
    architecture_summary,
    keras_layers,
    confidence,
    rationale,
    keras_snippet,
    target_type,
  };
}

/* ── Build feature map from parsed data ──────────────────────────────────── */

export function buildFeatureMap(
  rows: Record<string, string | number | null>[],
  columns: string[],
  targetCol: string
): FeatureMap {
  const fm: FeatureMap = {};

  for (const col of columns) {
    if (col === targetCol) {
      // Determine target type
      const vals = rows
        .map((r) => r[col])
        .filter((v) => v !== null);
      const numericVals = vals.filter((v) => typeof v === "number");
      const isNumeric = numericVals.length / Math.max(vals.length, 1) >= 0.8;

      let targetType: string;
      if (isNumeric) {
        const hasFloat = numericVals.some(
          (v) => typeof v === "number" && !Number.isInteger(v)
        );
        if (hasFloat) {
          targetType = "regression";
        } else {
          const unique = new Set(numericVals.map((v) => Number(v)));
          if (unique.size <= 2) targetType = "binary";
          else if (unique.size <= 20) targetType = "multiclass";
          else targetType = "regression";
        }
      } else {
        const unique = new Set(vals);
        if (unique.size <= 2) targetType = "binary";
        else if (unique.size <= 20) targetType = "multiclass";
        else targetType = "regression";
      }

      fm[col] = {
        role: "target",
        dtype: isNumeric ? "float32" : "string",
        cardinality: null,
        target_type: targetType,
      };
    } else {
      const vals = rows
        .map((r) => r[col])
        .filter((v) => v !== null);
      const numericVals = vals.filter((v) => typeof v === "number");
      const isNumeric = numericVals.length / Math.max(vals.length, 1) >= 0.8;

      if (isNumeric) {
        fm[col] = { role: "numeric", dtype: "float32", cardinality: null };
      } else {
        const unique = new Set(vals);
        fm[col] = {
          role: "categorical",
          dtype: "string",
          cardinality: unique.size,
        };
      }
    }
  }

  return fm;
}

/* ── Rule-based recommendation ───────────────────────────────────────────── */

export function recommend(
  featureMap: FeatureMap,
  rowCount: number = 10_000
): ModelRoadmap[] {
  const numericCols = Object.entries(featureMap)
    .filter(([, i]) => i.role === "numeric")
    .map(([n]) => n);
  const catCols = Object.entries(featureMap)
    .filter(([, i]) => i.role === "categorical")
    .map(([n]) => n);
  const targetInfo = Object.values(featureMap).find(
    (i) => i.role === "target"
  );
  const targetType = targetInfo?.target_type ?? "regression";
  const hasCats = catCols.length > 0;
  const hasNumerics = numericCols.length > 0;
  const highCard = hasHighCardinalityCats(featureMap);
  const highCorr = hasHighCorrelation(featureMap);

  const candidates: ModelRoadmap[] = [];

  // Rule 1 — all-numeric + regression → Deep MLP
  if (!hasCats && targetType === "regression") {
    let rationale =
      "All features are numeric and target is continuous; a deep MLP fits naturally.";
    if (highCorr) {
      rationale +=
        " High inter-feature correlation detected — consider Dropout / L2 regularisation.";
    }
    candidates.push(
      roadmap(
        1,
        "Deep MLP",
        "3-layer fully-connected network for tabular regression",
        ["Dense(256,relu)", "Dense(128,relu)", "Dense(64,relu)", "Dense(1)"],
        0.9,
        rationale,
        SNIPPETS.deep_mlp,
        targetType
      )
    );
  }

  // Rule 2 — mixed features + classification → Wide & Deep
  if (
    hasCats &&
    hasNumerics &&
    (targetType === "binary" || targetType === "multiclass")
  ) {
    candidates.push(
      roadmap(
        1,
        "Wide & Deep",
        "Wide linear path for memorisation, deep MLP path for generalisation",
        [
          "Dense(128,relu)",
          "Dense(64,relu)",
          "Concatenate",
          "Dense(1,sigmoid)",
        ],
        0.88,
        "Mixed numeric/categorical features with a classification target; Wide & Deep handles both memorisation and generalisation.",
        SNIPPETS.wide_deep,
        targetType
      )
    );
  }

  // Rule 3 — high-cardinality categoricals → Embeddings + MLP
  if (hasCats && highCard) {
    candidates.push(
      roadmap(
        1,
        "Embeddings + MLP",
        "Entity embeddings for high-cardinality categoricals fed into an MLP",
        ["Embedding(vocab,16)", "Flatten", "Dense(128,relu)", "Dense(1)"],
        0.85,
        "High-cardinality categorical columns benefit from learned embeddings over one-hot encoding.",
        SNIPPETS.emb_mlp,
        targetType
      )
    );
  }

  // Rule 4 — sequence/time heuristic
  const timeKeywords = [
    "time",
    "date",
    "seq",
    "step",
    "timestamp",
    "period",
    "lag",
  ];
  const hasTimeFeature = Object.keys(featureMap).some((col) =>
    timeKeywords.some((kw) => col.toLowerCase().includes(kw))
  );
  if (hasTimeFeature) {
    candidates.push(
      roadmap(
        2,
        "1D-CNN",
        "1-D convolution over sequential/temporal features",
        ["Conv1D(64,3,relu)", "GlobalMaxPooling1D", "Dense(1)"],
        0.8,
        "Time or sequence features detected; 1D-CNN captures local temporal patterns efficiently.",
        SNIPPETS.cnn_1d,
        targetType
      )
    );
    candidates.push(
      roadmap(
        3,
        "LSTM",
        "LSTM for long-range temporal dependencies",
        ["LSTM(64)", "Dense(1)"],
        0.78,
        "LSTM is preferred over 1D-CNN when long-range temporal dependencies matter.",
        SNIPPETS.lstm,
        targetType
      )
    );
  }

  // Rule 5 — small dataset → shallow MLP
  if (rowCount < 5_000) {
    candidates.push(
      roadmap(
        1,
        "Shallow MLP",
        "2-layer MLP suited for small datasets to avoid overfitting",
        ["Dense(32,relu)", "Dense(16,relu)", "Dense(1)"],
        0.82,
        `Dataset has only ${rowCount} rows; a shallow MLP reduces overfitting risk compared to deeper architectures.`,
        SNIPPETS.shallow_mlp,
        targetType
      )
    );
  }

  // Fallback — always include Deep MLP if nothing matched
  if (candidates.length === 0) {
    candidates.push(
      roadmap(
        1,
        "Deep MLP",
        "General-purpose 3-layer fully-connected network",
        ["Dense(256,relu)", "Dense(128,relu)", "Dense(64,relu)", "Dense(1)"],
        0.75,
        "No strong structural signal found; a Deep MLP is a robust baseline.",
        SNIPPETS.deep_mlp,
        targetType
      )
    );
  }

  // Deduplicate by model_type, sort by confidence desc, take top 3, re-rank
  const seen = new Set<string>();
  const unique: ModelRoadmap[] = [];
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  for (const rm of sorted) {
    if (!seen.has(rm.model_type)) {
      seen.add(rm.model_type);
      unique.push(rm);
    }
    if (unique.length === 3) break;
  }

  return unique.map((rm, i) => ({ ...rm, rank: i + 1 }));
}

/* ── LLM enrichment ──────────────────────────────────────────────────────── */

export async function enrichWithLLM(
  roadmaps: ModelRoadmap[],
  featureMap: FeatureMap,
  llmProvider?: string | null,
  llmKey?: string | null
): Promise<ModelRoadmap[]> {
  if (roadmaps.length === 0) return roadmaps;

  const provider = resolveProvider(llmProvider, llmKey);
  if (!provider) return roadmaps;

  try {
    const numeric = Object.entries(featureMap)
      .filter(([, i]) => i.role === "numeric")
      .map(([n]) => n);
    const cats = Object.entries(featureMap)
      .filter(([, i]) => i.role === "categorical")
      .map(([n]) => n);
    const target =
      Object.entries(featureMap).find(([, i]) => i.role === "target")?.[0] ??
      "target";
    const targetType =
      featureMap[target]?.target_type ?? "unknown";
    const top = roadmaps[0];

    const prompt =
      `You are designing a TensorFlow model.\n` +
      `Numeric features: ${JSON.stringify(numeric)}\n` +
      `Categorical features: ${JSON.stringify(cats)}\n` +
      `Target: ${target} (${targetType})\n` +
      `Recommended architecture: ${top.model_type} — ${top.architecture_summary}\n\n` +
      "Return ONLY a JSON object with two keys:\n" +
      '  "rationale": one paragraph explaining why this architecture fits the data,\n' +
      '  "keras_snippet": a self-contained tf.keras code snippet (no markdown fences).';

    const content = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You are a TensorFlow model architect. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      { provider, maxTokens: 800, temperature: 0.3, jsonMode: true }
    );

    if (!content) return roadmaps;

    const data = JSON.parse(content);
    let rationale =
      typeof data.rationale === "string" ? data.rationale : top.rationale;
    let snippet = data.keras_snippet;
    if (Array.isArray(snippet)) {
      snippet = snippet.map(String).join("\n");
    } else if (typeof snippet !== "string") {
      snippet = top.keras_snippet;
    }

    const enriched: ModelRoadmap = { ...top, rationale, keras_snippet: snippet };
    return [enriched, ...roadmaps.slice(1)];
  } catch {
    return roadmaps;
  }
}
