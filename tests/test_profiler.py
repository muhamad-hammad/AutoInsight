from __future__ import annotations

import csv
import math
from pathlib import Path
from unittest.mock import patch

import pytest
import tensorflow as tf

from backend.pipeline.profiler import _welford_merge_batch, profile_dataset
from backend.models.profile import DataProfile


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_float_dataset(values: list[float], feat: str = "x") -> tf.data.Dataset:
    """Return a tf.data.Dataset with a single float32 feature."""
    tensors = {feat: tf.constant(values, dtype=tf.float32)}
    return tf.data.Dataset.from_tensor_slices(tensors)


# ── single-pass guarantee ─────────────────────────────────────────────────────

def test_single_pass_over_dataset(tmp_path, monkeypatch):
    """profile_dataset must iterate the dataset exactly once."""
    pass_count = [0]

    def counting_ds():
        def _gen():
            pass_count[0] += 1
            for v in [1.0, 2.0, 3.0]:
                yield {"x": tf.constant(v, dtype=tf.float32)}

        return tf.data.Dataset.from_generator(
            _gen,
            output_signature={"x": tf.TensorSpec([], tf.float32)},
        )

    with patch("backend.pipeline.profiler.load_dataset", return_value=counting_ds()):
        profile_dataset("fake_id")

    assert pass_count[0] == 1, (
        f"Expected exactly 1 pass over the dataset, got {pass_count[0]}"
    )


# ── Welford accuracy ──────────────────────────────────────────────────────────

def test_welford_accuracy():
    """Mean and sample variance must match hand-computed values within 1e-9."""
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    # Population: mean=3, sample variance = sum((x-3)^2)/(n-1) = 10/4 = 2.5
    expected_mean = 3.0
    expected_var = 2.5

    n_num = 1
    count = tf.Variable(tf.zeros([n_num], tf.int64))
    mean = tf.Variable(tf.zeros([n_num], tf.float64))
    M2 = tf.Variable(tf.zeros([n_num], tf.float64))
    min_v = tf.Variable(tf.cast(tf.fill([n_num], 1e38), tf.float64))
    max_v = tf.Variable(tf.cast(tf.fill([n_num], -1e38), tf.float64))

    # Feed in two batches to also test the Chan merge path
    batch1 = tf.constant([[v] for v in values[:3]], dtype=tf.float64)
    batch2 = tf.constant([[v] for v in values[3:]], dtype=tf.float64)
    _welford_merge_batch(count, mean, M2, min_v, max_v, batch1)
    _welford_merge_batch(count, mean, M2, min_v, max_v, batch2)

    n = int(count[0].numpy())
    computed_mean = float(mean[0].numpy())
    computed_var = float(M2[0].numpy()) / (n - 1)

    assert abs(computed_mean - expected_mean) < 1e-9, (
        f"mean: expected {expected_mean}, got {computed_mean}"
    )
    assert abs(computed_var - expected_var) < 1e-9, (
        f"variance: expected {expected_var}, got {computed_var}"
    )


def test_welford_min_max():
    values = [-3.0, 0.0, 7.5, 2.0]
    n_num = 1
    count = tf.Variable(tf.zeros([n_num], tf.int64))
    mean = tf.Variable(tf.zeros([n_num], tf.float64))
    M2 = tf.Variable(tf.zeros([n_num], tf.float64))
    min_v = tf.Variable(tf.cast(tf.fill([n_num], 1e38), tf.float64))
    max_v = tf.Variable(tf.cast(tf.fill([n_num], -1e38), tf.float64))

    batch = tf.constant([[v] for v in values], dtype=tf.float64)
    _welford_merge_batch(count, mean, M2, min_v, max_v, batch)

    assert float(min_v[0].numpy()) == pytest.approx(-3.0)
    assert float(max_v[0].numpy()) == pytest.approx(7.5)


def test_profile_dataset_returns_dataprofile(monkeypatch):
    """profile_dataset returns a DataProfile with correct row_count."""
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    ds = _make_float_dataset(values)

    with patch("backend.pipeline.profiler.load_dataset", return_value=ds):
        result = profile_dataset("fake_id")

    assert isinstance(result, DataProfile)
    assert result.dataset_id == "fake_id"
    assert result.row_count == len(values)
    assert result.feature_count == 1
    stat = result.features[0]
    assert stat.name == "x"
    assert stat.mean == pytest.approx(3.0, abs=1e-4)
    assert stat.variance == pytest.approx(2.5, abs=1e-4)
