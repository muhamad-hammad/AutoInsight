from __future__ import annotations

import csv
import math
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.pipeline.profiler import profile_dataset, DATA_DIR
from backend.models.profile import DataProfile


# ── helpers ───────────────────────────────────────────────────────────────────

def _write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _setup_dataset(tmp_path: Path, dataset_id: str, fieldnames: list[str], rows: list[dict]) -> Path:
    """Create a fake dataset directory with a raw.csv inside."""
    dataset_dir = tmp_path / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)
    _write_csv(dataset_dir / "raw.csv", fieldnames, rows)
    return dataset_dir


# ── basic profiling ──────────────────────────────────────────────────────────

def test_profile_returns_dataprofile(tmp_path):
    """profile_dataset returns a DataProfile with correct row_count and features."""
    rows = [{"x": float(i), "y": float(i * 2)} for i in range(100)]
    _setup_dataset(tmp_path, "basic", ["x", "y"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("basic")

    assert isinstance(result, DataProfile)
    assert result.dataset_id == "basic"
    assert result.row_count == 100
    assert result.feature_count == 2


def test_numeric_feature_stats(tmp_path):
    """Numeric features must have mean, variance, min, max computed correctly."""
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    rows = [{"val": v} for v in values]
    _setup_dataset(tmp_path, "nums", ["val"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("nums")

    stat = result.features[0]
    assert stat.name == "val"
    assert stat.mean == pytest.approx(3.0, abs=1e-4)
    # pandas uses ddof=1 (sample variance) by default
    assert stat.variance == pytest.approx(2.5, abs=1e-4)
    assert stat.min_val == pytest.approx(1.0)
    assert stat.max_val == pytest.approx(5.0)
    assert stat.null_count == 0
    assert stat.null_pct == 0.0


def test_categorical_feature_stats(tmp_path):
    """Categorical features must have cardinality computed."""
    rows = [{"cat": c} for c in ["a", "b", "c", "a", "b"]]
    _setup_dataset(tmp_path, "cats", ["cat"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("cats")

    stat = result.features[0]
    assert stat.name == "cat"
    assert stat.cardinality == 3
    assert stat.mean is None
    assert stat.variance is None


def test_null_handling(tmp_path):
    """Null values must be counted and null_pct calculated correctly."""
    rows = [{"val": ""}, {"val": "1.0"}, {"val": ""}, {"val": "3.0"}, {"val": "5.0"}]
    _setup_dataset(tmp_path, "nulls", ["val"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("nulls")

    stat = result.features[0]
    assert stat.null_count == 2
    assert stat.null_pct == pytest.approx(40.0, abs=0.1)


def test_correlation_matrix(tmp_path):
    """Correlation matrix must be computed for numeric features."""
    import random
    rng = random.Random(42)
    rows = [{"a": float(i), "b": float(i) + rng.uniform(-0.01, 0.01), "c": rng.uniform(0, 100)}
            for i in range(100)]
    _setup_dataset(tmp_path, "corr", ["a", "b", "c"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("corr")

    assert "a" in result.correlation_matrix
    assert "b" in result.correlation_matrix["a"]
    # a and b are nearly perfectly correlated
    assert abs(result.correlation_matrix["a"]["b"]) > 0.99


def test_high_correlation_flag(tmp_path):
    """Features with |r| > 0.85 should appear in high_correlation list."""
    rows = [{"x": float(i), "y": float(i * 2)} for i in range(100)]
    _setup_dataset(tmp_path, "hicorr", ["x", "y"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("hicorr")

    x_stat = next(f for f in result.features if f.name == "x")
    assert "y" in x_stat.high_correlation


def test_mixed_numeric_and_categorical(tmp_path):
    """Profile with both numeric and categorical columns."""
    rows = [
        {"age": 25.0, "city": "NY", "score": 80.0},
        {"age": 30.0, "city": "SF", "score": 90.0},
        {"age": 35.0, "city": "NY", "score": 70.0},
        {"age": 40.0, "city": "LA", "score": 85.0},
    ]
    _setup_dataset(tmp_path, "mixed", ["age", "city", "score"], rows)

    with patch("backend.pipeline.profiler.DATA_DIR", tmp_path):
        result = profile_dataset("mixed")

    assert result.feature_count == 3
    numeric_feats = [f for f in result.features if f.mean is not None]
    cat_feats = [f for f in result.features if f.cardinality is not None]
    assert len(numeric_feats) == 2  # age, score
    assert len(cat_feats) == 1      # city
