from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.models.roadmap import ModelRoadmap
from backend.pipeline.advisor import (
    FeatureMap,
    enrich_with_openai,
    inspect_spec,
    recommend,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _fm(
    numerics: list[str],
    cats: list[str],
    target: str,
    target_type: str = "regression",
    high_card: bool = False,
) -> FeatureMap:
    fm: FeatureMap = {}
    for n in numerics:
        fm[n] = {"role": "numeric", "dtype": "float32", "cardinality": None}
    for c in cats:
        card = 200 if high_card else 5
        fm[c] = {"role": "categorical", "dtype": "string", "cardinality": card}
    fm[target] = {
        "role": "target",
        "dtype": "float32" if target_type == "regression" else "int32",
        "cardinality": None,
        "target_type": target_type,
    }
    return fm


def _assert_top3(roadmaps: list[ModelRoadmap]) -> None:
    assert 1 <= len(roadmaps) <= 3
    for i, rm in enumerate(roadmaps):
        assert rm.rank == i + 1
        assert 0.0 <= rm.confidence <= 1.0
        assert rm.model_type
        assert rm.keras_snippet


# ── inspect_spec ──────────────────────────────────────────────────────────────

class _FakeTensorSpec:
    def __init__(self, dtype_name: str):
        self.dtype = MagicMock()
        self.dtype.name = dtype_name


def test_inspect_spec_classifies_roles():
    spec = {
        "age": _FakeTensorSpec("float32"),
        "city": _FakeTensorSpec("string"),
        "label": _FakeTensorSpec("int32"),
    }
    fm = inspect_spec(spec, "label")  # type: ignore[arg-type]
    assert fm["age"]["role"] == "numeric"
    assert fm["city"]["role"] == "categorical"
    assert fm["label"]["role"] == "target"


def test_inspect_spec_int_as_numeric():
    spec = {
        "count": _FakeTensorSpec("int64"),
        "target": _FakeTensorSpec("float32"),
    }
    fm = inspect_spec(spec, "target")  # type: ignore[arg-type]
    assert fm["count"]["role"] == "numeric"


# ── recommend — all 6 rule conditions ─────────────────────────────────────────

def test_rule1_all_numeric_regression():
    fm = _fm(["a", "b", "c"], [], "y", target_type="regression")
    result = recommend(fm, row_count=10_000)
    _assert_top3(result)
    types = [r.model_type for r in result]
    assert "Deep MLP" in types


def test_rule2_mixed_classification():
    fm = _fm(["age", "income"], ["city", "gender"], "label", target_type="binary")
    result = recommend(fm, row_count=10_000)
    _assert_top3(result)
    assert any(r.model_type == "Wide & Deep" for r in result)


def test_rule3_high_cardinality_cats():
    fm = _fm(["num1"], ["cat1", "cat2"], "y", target_type="regression", high_card=True)
    result = recommend(fm, row_count=10_000)
    _assert_top3(result)
    assert any(r.model_type == "Embeddings + MLP" for r in result)


def test_rule4_sequence_time_features():
    fm = _fm(["lag1", "lag2", "timestamp"], [], "y", target_type="regression")
    # timestamp triggers sequence heuristic
    result = recommend(fm, row_count=10_000)
    _assert_top3(result)
    seq_types = {"1D-CNN", "LSTM"}
    assert any(r.model_type in seq_types for r in result)


def test_rule5_small_dataset():
    fm = _fm(["a", "b"], [], "y", target_type="regression")
    result = recommend(fm, row_count=500)
    _assert_top3(result)
    assert any(r.model_type == "Shallow MLP" for r in result)


def test_rule6_high_correlation_note():
    fm = _fm(["a", "b"], [], "y", target_type="regression")
    fm["a"]["high_correlation"] = ["b"]
    result = recommend(fm, row_count=10_000)
    _assert_top3(result)
    top_rationale = result[0].rationale
    assert "Dropout" in top_rationale or "L2" in top_rationale or "correlation" in top_rationale.lower()


# ── enrich_with_openai ────────────────────────────────────────────────────────

def test_enrich_updates_top_roadmap():
    fm = _fm(["a", "b"], [], "y", target_type="regression")
    roadmaps = recommend(fm, row_count=10_000)

    enriched_rationale = "Ollama says this architecture is great."
    enriched_snippet = "model = tf.keras.Sequential([tf.keras.layers.Dense(1)])"

    fake_http_resp = MagicMock()
    fake_http_resp.json.return_value = {
        "message": {"content": json.dumps({"rationale": enriched_rationale, "keras_snippet": enriched_snippet})}
    }
    fake_http_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=fake_http_resp)
    mock_async_ctx = MagicMock()
    mock_async_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_async_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_async_ctx):
        result = asyncio.run(enrich_with_openai(roadmaps, fm))

    assert result[0].rationale == enriched_rationale
    assert result[0].keras_snippet == enriched_snippet
    if len(result) > 1:
        assert result[1].rationale == roadmaps[1].rationale


def test_enrich_falls_back_on_error():
    fm = _fm(["a"], [], "y")
    roadmaps = recommend(fm, row_count=10_000)
    original_rationale = roadmaps[0].rationale

    mock_async_ctx = MagicMock()
    mock_async_ctx.__aenter__ = AsyncMock(side_effect=Exception("Ollama down"))
    mock_async_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_async_ctx):
        result = asyncio.run(enrich_with_openai(roadmaps, fm))

    assert result[0].rationale == original_rationale


def test_enrich_empty_list():
    result = asyncio.run(enrich_with_openai([], {}))
    assert result == []
