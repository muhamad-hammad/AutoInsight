from __future__ import annotations

import json
import os
from typing import Literal

import tensorflow as tf

from backend.models.roadmap import ModelRoadmap

FeatureRole = Literal["numeric", "categorical", "target"]

FeatureMap = dict[str, dict]
# Each entry: {"role": FeatureRole, "dtype": str, "cardinality": int | None}


def inspect_spec(
    element_spec: dict[str, tf.TensorSpec], target_col: str
) -> FeatureMap:
    feature_map: FeatureMap = {}
    for name, spec in element_spec.items():
        dtype_name = spec.dtype.name
        if name == target_col:
            role: FeatureRole = "target"
        elif "float" in dtype_name or "int" in dtype_name:
            role = "numeric"
        else:
            role = "categorical"
        feature_map[name] = {"role": role, "dtype": dtype_name, "cardinality": None}
    return feature_map


def _detect_target_type(
    dataset_id: str, target_col: str, feature_map: FeatureMap
) -> str:
    target_dtype = feature_map.get(target_col, {}).get("dtype", "float32")
    if "float" in target_dtype:
        return "regression"

    # Count unique values for integer targets (sample first 4096 rows)
    from backend.pipeline.store import load_dataset

    ds = load_dataset(dataset_id)
    unique: set = set()
    for batch in ds.batch(4096).take(1):
        vals = batch.get(target_col)
        if vals is not None:
            for v in vals.numpy().flatten():
                unique.add(int(v))
    if len(unique) <= 2:
        return "binary"
    if len(unique) <= 20:
        return "multiclass"
    return "regression"


def _count_rows(dataset_id: str) -> int:
    from backend.pipeline.store import load_dataset

    ds = load_dataset(dataset_id)
    count = 0
    for batch in ds.batch(4096):
        first_val = next(iter(batch.values()))
        count += int(first_val.shape[0])
    return count


def _has_high_cardinality_cats(feature_map: FeatureMap) -> bool:
    for info in feature_map.values():
        if info["role"] == "categorical":
            card = info.get("cardinality")
            if card is None or card > 50:
                return True
    return False


def _has_high_correlation(feature_map: FeatureMap) -> bool:
    return any(
        info.get("high_correlation") for info in feature_map.values()
    )


def _roadmap(
    rank: int,
    model_type: str,
    summary: str,
    layers: list[str],
    confidence: float,
    rationale: str,
    snippet: str,
    target_type: str,
) -> ModelRoadmap:
    return ModelRoadmap(
        rank=rank,
        model_type=model_type,
        architecture_summary=summary,
        keras_layers=layers,
        confidence=confidence,
        rationale=rationale,
        keras_snippet=snippet,
        target_type=target_type,
    )


_SNIPPETS: dict[str, str] = {
    "deep_mlp": (
        "model = tf.keras.Sequential([\n"
        "    tf.keras.layers.Dense(256, activation='relu'),\n"
        "    tf.keras.layers.Dense(128, activation='relu'),\n"
        "    tf.keras.layers.Dense(64, activation='relu'),\n"
        "    tf.keras.layers.Dense(1),\n"
        "])"
    ),
    "wide_deep": (
        "wide = tf.keras.layers.concatenate([cat_inputs, num_inputs])\n"
        "deep = tf.keras.layers.Dense(128, activation='relu')(num_inputs)\n"
        "deep = tf.keras.layers.Dense(64, activation='relu')(deep)\n"
        "output = tf.keras.layers.Dense(1, activation='sigmoid')(\n"
        "    tf.keras.layers.concatenate([wide, deep])\n"
        ")"
    ),
    "emb_mlp": (
        "emb = tf.keras.layers.Embedding(vocab_size, 16)(cat_input)\n"
        "flat = tf.keras.layers.Flatten()(emb)\n"
        "x = tf.keras.layers.Dense(128, activation='relu')(\n"
        "    tf.keras.layers.concatenate([flat, num_input])\n"
        ")\n"
        "output = tf.keras.layers.Dense(1)(x)"
    ),
    "cnn_1d": (
        "x = tf.keras.layers.Conv1D(64, 3, activation='relu')(seq_input)\n"
        "x = tf.keras.layers.GlobalMaxPooling1D()(x)\n"
        "output = tf.keras.layers.Dense(1)(x)"
    ),
    "lstm": (
        "x = tf.keras.layers.LSTM(64, return_sequences=False)(seq_input)\n"
        "output = tf.keras.layers.Dense(1)(x)"
    ),
    "shallow_mlp": (
        "model = tf.keras.Sequential([\n"
        "    tf.keras.layers.Dense(32, activation='relu'),\n"
        "    tf.keras.layers.Dense(16, activation='relu'),\n"
        "    tf.keras.layers.Dense(1),\n"
        "])"
    ),
}


def recommend(feature_map: FeatureMap, row_count: int = 10_000) -> list[ModelRoadmap]:
    numeric_cols = [n for n, i in feature_map.items() if i["role"] == "numeric"]
    cat_cols = [n for n, i in feature_map.items() if i["role"] == "categorical"]
    target_info = next(
        (i for i in feature_map.values() if i["role"] == "target"), {}
    )
    target_type = target_info.get("target_type", "regression")
    has_cats = bool(cat_cols)
    has_numerics = bool(numeric_cols)
    high_card = _has_high_cardinality_cats(feature_map)
    high_corr = _has_high_correlation(feature_map)

    candidates: list[ModelRoadmap] = []

    # Rule 1 — all-numeric + regression → Deep MLP
    if not has_cats and target_type == "regression":
        rationale = "All features are numeric and target is continuous; a deep MLP fits naturally."
        if high_corr:
            rationale += " High inter-feature correlation detected — consider Dropout / L2 regularisation."
        candidates.append(_roadmap(
            1, "Deep MLP",
            "3-layer fully-connected network for tabular regression",
            ["Dense(256,relu)", "Dense(128,relu)", "Dense(64,relu)", "Dense(1)"],
            0.90, rationale, _SNIPPETS["deep_mlp"], target_type,
        ))

    # Rule 2 — mixed features + classification → Wide & Deep
    if has_cats and has_numerics and target_type in ("binary", "multiclass"):
        candidates.append(_roadmap(
            1, "Wide & Deep",
            "Wide linear path for memorisation, deep MLP path for generalisation",
            ["Dense(128,relu)", "Dense(64,relu)", "Concatenate", "Dense(1,sigmoid)"],
            0.88,
            "Mixed numeric/categorical features with a classification target; Wide & Deep handles both memorisation and generalisation.",
            _SNIPPETS["wide_deep"], target_type,
        ))

    # Rule 3 — high-cardinality categoricals → Embeddings + MLP
    if has_cats and high_card:
        candidates.append(_roadmap(
            1, "Embeddings + MLP",
            "Entity embeddings for high-cardinality categoricals fed into an MLP",
            ["Embedding(vocab,16)", "Flatten", "Dense(128,relu)", "Dense(1)"],
            0.85,
            "High-cardinality categorical columns benefit from learned embeddings over one-hot encoding.",
            _SNIPPETS["emb_mlp"], target_type,
        ))

    # Rule 4 — sequence/time heuristic (feature named 'time'/'date'/'seq'/'step')
    time_keywords = {"time", "date", "seq", "step", "timestamp", "period", "lag"}
    has_time_feature = any(
        any(kw in col.lower() for kw in time_keywords)
        for col in feature_map
    )
    if has_time_feature:
        candidates.append(_roadmap(
            2, "1D-CNN",
            "1-D convolution over sequential/temporal features",
            ["Conv1D(64,3,relu)", "GlobalMaxPooling1D", "Dense(1)"],
            0.80,
            "Time or sequence features detected; 1D-CNN captures local temporal patterns efficiently.",
            _SNIPPETS["cnn_1d"], target_type,
        ))
        candidates.append(_roadmap(
            3, "LSTM",
            "LSTM for long-range temporal dependencies",
            ["LSTM(64)", "Dense(1)"],
            0.78,
            "LSTM is preferred over 1D-CNN when long-range temporal dependencies matter.",
            _SNIPPETS["lstm"], target_type,
        ))

    # Rule 5 — small dataset → shallow MLP
    if row_count < 5_000:
        candidates.append(_roadmap(
            1, "Shallow MLP",
            "2-layer MLP suited for small datasets to avoid overfitting",
            ["Dense(32,relu)", "Dense(16,relu)", "Dense(1)"],
            0.82,
            f"Dataset has only {row_count} rows; a shallow MLP reduces overfitting risk compared to deeper architectures.",
            _SNIPPETS["shallow_mlp"], target_type,
        ))

    # Fallback — always include Deep MLP if nothing matched
    if not candidates:
        candidates.append(_roadmap(
            1, "Deep MLP",
            "General-purpose 3-layer fully-connected network",
            ["Dense(256,relu)", "Dense(128,relu)", "Dense(64,relu)", "Dense(1)"],
            0.75,
            "No strong structural signal found; a Deep MLP is a robust baseline.",
            _SNIPPETS["deep_mlp"], target_type,
        ))

    # Deduplicate by model_type, sort by confidence desc, take top 3, re-rank
    seen: set[str] = set()
    unique: list[ModelRoadmap] = []
    for rm in sorted(candidates, key=lambda r: r.confidence, reverse=True):
        if rm.model_type not in seen:
            seen.add(rm.model_type)
            unique.append(rm)
        if len(unique) == 3:
            break

    return [rm.model_copy(update={"rank": i + 1}) for i, rm in enumerate(unique)]


async def enrich_with_openai(
    roadmaps: list[ModelRoadmap], feature_map: FeatureMap
) -> list[ModelRoadmap]:
    """Replace roadmaps[0].rationale and keras_snippet with Ollama output."""
    if not roadmaps:
        return roadmaps
    try:
        import httpx

        numeric = [n for n, i in feature_map.items() if i["role"] == "numeric"]
        cats = [n for n, i in feature_map.items() if i["role"] == "categorical"]
        target = next(
            (n for n, i in feature_map.items() if i["role"] == "target"), "target"
        )
        target_type = feature_map.get(target, {}).get("target_type", "unknown")
        top = roadmaps[0]

        prompt = (
            f"You are designing a TensorFlow model.\n"
            f"Numeric features: {numeric}\n"
            f"Categorical features: {cats}\n"
            f"Target: {target} ({target_type})\n"
            f"Recommended architecture: {top.model_type} — {top.architecture_summary}\n\n"
            "Return ONLY a JSON object with two keys:\n"
            '  "rationale": one paragraph explaining why this architecture fits the data,\n'
            '  "keras_snippet": a self-contained tf.keras code snippet (no markdown fences).'
        )

        ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.environ.get("OLLAMA_MODEL", "llama3")

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are a TensorFlow model architect. Always respond with valid JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                    "format": "json",
                },
            )
            resp.raise_for_status()
            content = resp.json()["message"]["content"]

        data = json.loads(content)
        enriched = top.model_copy(update={
            "rationale": data.get("rationale", top.rationale),
            "keras_snippet": data.get("keras_snippet", top.keras_snippet),
        })
        return [enriched] + roadmaps[1:]
    except Exception:
        return roadmaps
