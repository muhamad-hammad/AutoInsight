from __future__ import annotations

import csv as _csv
import tracemalloc
from unittest.mock import patch

import numpy as np
import pytest
import tensorflow as tf

import backend.pipeline.store as store_module
from backend.models.profile import DataProfile
from backend.models.roadmap import ModelRoadmap
from backend.pipeline.advisor import FeatureMap, inspect_spec, recommend
from backend.pipeline.ingest import build_dataset
from backend.pipeline.profiler import profile_dataset
from backend.pipeline.store import save_dataset

# ── shared schemas ────────────────────────────────────────────────────────────

_MIXED_SCHEMA = {
    "age": "float64",
    "score": "float64",
    "income": "float64",
    "city": "object",
    "label": "float64",
}

_NULL_SCHEMA = {
    "value": "float64",
    "broken": "float64",
    "label": "float64",
}

_CAT_ONLY_SCHEMA = {
    "country": "object",
    "product": "object",
    "status": "object",
    "label": "object",
}

_BIG_SCHEMA = {
    "a": "float64",
    "b": "float64",
    "c": "float64",
    "cat": "object",
    "label": "float64",
}


# ═══════════════════════════════════════════════════════════════════════════════
# INGEST
# ═══════════════════════════════════════════════════════════════════════════════

class TestIngest:
    def test_element_spec_matches_schema(self, small_csv):
        """element_spec keys and dtypes must reflect the CSV schema after preprocessing."""
        ds = build_dataset(str(small_csv), _MIXED_SCHEMA)
        spec = ds.element_spec

        assert set(spec.keys()) == set(_MIXED_SCHEMA.keys())

        # Numeric cols → float32 after Normalization layer
        for col in ("age", "score", "income", "label"):
            assert spec[col].dtype == tf.float32, (
                f"{col}: expected float32, got {spec[col].dtype}"
            )

        # Categorical col → integer index after StringLookup
        assert spec["city"].dtype in (tf.int32, tf.int64), (
            f"city: expected int tensor, got {spec['city'].dtype}"
        )

    def test_all_null_col_no_nan_output(self, all_null_col_csv):
        """An entirely-empty numeric column must produce zero-filled tensors (no NaN leaks)."""
        ds = build_dataset(str(all_null_col_csv), _NULL_SCHEMA)
        for batch in ds.batch(64):
            vals = batch["broken"].numpy()
            assert not np.any(np.isnan(vals)), (
                "NaN leaked through ingest for all-null column"
            )

    def test_categorical_col_is_int_tensor(self, small_csv):
        """StringLookup must encode every categorical value as a non-negative integer."""
        ds = build_dataset(str(small_csv), _MIXED_SCHEMA)
        spec = ds.element_spec

        assert spec["city"].dtype in (tf.int32, tf.int64)

        for batch in ds.batch(256).take(1):
            ints = batch["city"].numpy()
            assert ints.ndim == 1
            assert np.all(ints >= 0), "StringLookup produced a negative index"

    def test_cat_only_csv_builds_without_error(self, cat_only_csv):
        """build_dataset must succeed when every column is categorical."""
        ds = build_dataset(str(cat_only_csv), _CAT_ONLY_SCHEMA)
        spec = ds.element_spec
        for col in _CAT_ONLY_SCHEMA:
            assert spec[col].dtype in (tf.int32, tf.int64), (
                f"{col}: expected int tensor, got {spec[col].dtype}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# PROFILER (pandas-based)
# ═══════════════════════════════════════════════════════════════════════════════

def _write_csv(path, fieldnames, rows):
    with open(path, "w", newline="") as fh:
        writer = _csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _setup_dataset(base_dir, dataset_id, fieldnames, rows):
    dataset_dir = base_dir / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)
    _write_csv(dataset_dir / "raw.csv", fieldnames, rows)
    return dataset_dir


class TestProfiler:
    def test_profile_returns_correct_structure(self, tmp_path):
        """profile_dataset must return a DataProfile with correct row_count."""
        rows = [{"x": float(i), "y": float(i * 2)} for i in range(50)]
        _setup_dataset(tmp_path, "struct", ["x", "y"], rows)

        with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
            profile = profile_dataset("struct")

        assert isinstance(profile, DataProfile)
        assert profile.dataset_id == "struct"
        assert profile.row_count == 50
        assert profile.feature_count == 2

    def test_mean_variance_vs_numpy(self, small_csv, tmp_path):
        """Profiler mean/variance must match numpy within tolerance 1e-4."""
        import pandas as pd

        # Set up a dataset from the small_csv fixture
        dataset_id = "wf-accuracy"
        dataset_dir = tmp_path / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)

        # Copy the fixture CSV to raw.csv
        import shutil
        shutil.copy(str(small_csv), str(dataset_dir / "raw.csv"))

        # Compute expected values from pandas
        df = pd.read_csv(small_csv)
        expected_mean = float(df["age"].mean())
        expected_var = float(df["age"].var())  # ddof=1 by default

        with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
            profile = profile_dataset(dataset_id)

        age_stat = next(f for f in profile.features if f.name == "age")

        assert age_stat.mean is not None
        assert age_stat.variance is not None
        assert abs(age_stat.mean - expected_mean) < 1e-4, (
            f"mean: expected {expected_mean:.6f}, got {age_stat.mean:.6f}"
        )
        assert abs(age_stat.variance - expected_var) < 1e-4, (
            f"variance: expected {expected_var:.6f}, got {age_stat.variance:.6f}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# ADVISOR — all 6 rule conditions
# ═══════════════════════════════════════════════════════════════════════════════

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
        fm[c] = {"role": "categorical", "dtype": "string", "cardinality": 200 if high_card else 5}
    fm[target] = {
        "role": "target",
        "dtype": "float32" if target_type == "regression" else "int32",
        "cardinality": None,
        "target_type": target_type,
    }
    return fm


@pytest.mark.parametrize(
    "fm,row_count,expected_type",
    [
        # Rule 1 — all-numeric + regression → Deep MLP
        (_fm(["a", "b", "c"], [], "y"), 10_000, "Deep MLP"),
        # Rule 2 — mixed + classification → Wide & Deep
        (_fm(["age"], ["city"], "label", "binary"), 10_000, "Wide & Deep"),
        # Rule 3 — high-cardinality categoricals → Embeddings + MLP
        (_fm(["num"], ["cat"], "y", high_card=True), 10_000, "Embeddings + MLP"),
        # Rule 4 — time/sequence feature name → 1D-CNN or LSTM
        (_fm(["timestamp", "lag1"], [], "y"), 10_000, None),  # checked separately
        # Rule 5 — small dataset → Shallow MLP
        (_fm(["a", "b"], [], "y"), 500, "Shallow MLP"),
    ],
)
def test_advisor_rule_model_type(fm, row_count, expected_type):
    result = recommend(fm, row_count=row_count)
    assert 1 <= len(result) <= 3
    types = {r.model_type for r in result}
    if expected_type is not None:
        assert expected_type in types, f"Expected {expected_type!r} in {types}"


def test_advisor_rule4_sequence_features():
    """Rule 4: features with time/seq names must trigger 1D-CNN or LSTM."""
    fm = _fm(["timestamp", "lag1", "lag2"], [], "y")
    result = recommend(fm, row_count=10_000)
    seq_types = {"1D-CNN", "LSTM"}
    assert any(r.model_type in seq_types for r in result), (
        f"Expected a sequence model in {[r.model_type for r in result]}"
    )


def test_advisor_rule6_high_correlation_note():
    """Rule 6: high inter-feature correlation must mention regularisation in rationale."""
    fm = _fm(["a", "b"], [], "y")
    fm["a"]["high_correlation"] = ["b"]
    result = recommend(fm, row_count=10_000)
    top_rationale = result[0].rationale.lower()
    assert any(kw in top_rationale for kw in ("dropout", "l2", "regulariz", "correlation")), (
        f"Rationale does not mention regularisation: {result[0].rationale!r}"
    )


# ═══════════════════════════════════════════════════════════════════════════════
# INTEGRATION — CSV → profile → recommend
# ═══════════════════════════════════════════════════════════════════════════════

class TestIntegration:
    def test_full_pipeline_field_types(self, small_csv, tmp_path, monkeypatch):
        """CSV path → profile → build dataset → recommend returns correct model types.
        OpenAI is mocked so the test runs offline."""
        monkeypatch.setattr(store_module, "DATA_DIR", tmp_path)

        dataset_id = "integration-run"
        dataset_dir = tmp_path / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)

        # Copy fixture CSV as raw.csv
        import shutil
        shutil.copy(str(small_csv), str(dataset_dir / "raw.csv"))

        # Profile step (pandas-based, reads raw.csv)
        with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
            profile = profile_dataset(dataset_id)

        assert isinstance(profile, DataProfile)
        assert profile.dataset_id == dataset_id
        assert profile.row_count == 1_000
        assert profile.feature_count == len(_MIXED_SCHEMA)
        assert isinstance(profile.features, list)
        assert len(profile.features) == len(_MIXED_SCHEMA)
        # Numeric features have mean/variance populated
        numeric_stats = [f for f in profile.features if f.dtype == "float32"]
        for stat in numeric_stats:
            assert stat.mean is not None
            assert stat.variance is not None
            assert stat.variance >= 0.0

        # Build TF dataset and save for the recommend step
        ds = build_dataset(str(small_csv), _MIXED_SCHEMA)
        save_dataset(ds, tmp_path / dataset_id)

        # Recommend step
        loaded = store_module.load_dataset(dataset_id)
        feature_map = inspect_spec(loaded.element_spec, "label")
        feature_map["label"]["target_type"] = "regression"

        roadmaps = recommend(feature_map, row_count=profile.row_count)

        assert 1 <= len(roadmaps) <= 3
        for i, rm in enumerate(roadmaps):
            assert isinstance(rm, ModelRoadmap)
            assert rm.rank == i + 1
            assert isinstance(rm.model_type, str) and rm.model_type
            assert isinstance(rm.keras_snippet, str) and rm.keras_snippet
            assert isinstance(rm.architecture_summary, str)
            assert isinstance(rm.keras_layers, list)
            assert 0.0 <= rm.confidence <= 1.0
            assert rm.target_type == "regression"


# ═══════════════════════════════════════════════════════════════════════════════
# MEMORY — peak < 512 MB on a ~50 MB CSV
# ═══════════════════════════════════════════════════════════════════════════════

class TestMemory:
    def test_peak_memory_under_512mb(self, fixture_50mb_csv, tmp_path):
        """Peak Python-tracked memory during profiling a ~50 MB CSV must stay under 512 MB."""
        dataset_id = "mem-test"
        dataset_dir = tmp_path / dataset_id
        dataset_dir.mkdir(parents=True, exist_ok=True)

        # Copy fixture CSV to raw.csv
        import shutil
        shutil.copy(str(fixture_50mb_csv), str(dataset_dir / "raw.csv"))

        tracemalloc.start()
        try:
            with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
                profile_dataset(dataset_id)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()

        peak_mb = peak / 1024 / 1024
        assert peak_mb < 512, (
            f"Peak Python memory {peak_mb:.1f} MB exceeds 512 MB limit"
        )
