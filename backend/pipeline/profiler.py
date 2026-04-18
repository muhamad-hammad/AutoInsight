from __future__ import annotations

import math
from datetime import datetime, timezone

import tensorflow as tf

from backend.models.profile import DataProfile, FeatureStat
from backend.pipeline.store import load_dataset

# ── HyperLogLog constants ─────────────────────────────────────────────────────

_HLL_P = 12
_HLL_M = 1 << _HLL_P  # 4096 buckets

_MIX_C1 = tf.constant(0xFF51AFD7ED558CCD, dtype=tf.uint64)
_MIX_C2 = tf.constant(0xC4CEB9FE1A85EC53, dtype=tf.uint64)
_HLL_BITS = 64 - _HLL_P  # 52 bits for rho computation


def _mix64(x: tf.Tensor) -> tf.Tensor:
    """MurmurHash3 uint64 finalizer — maps integers to uniform bit patterns."""
    shift = tf.constant(33, tf.uint64)
    x = tf.bitwise.bitwise_xor(x, tf.bitwise.right_shift(x, shift))
    x = x * _MIX_C1
    x = tf.bitwise.bitwise_xor(x, tf.bitwise.right_shift(x, shift))
    x = x * _MIX_C2
    x = tf.bitwise.bitwise_xor(x, tf.bitwise.right_shift(x, shift))
    return x


def _rho(val: tf.Tensor) -> tf.Tensor:
    """Position of the first 1-bit from the MSB in the lower _HLL_BITS bits (1-indexed)."""
    # Mask to lower _HLL_BITS bits
    mask = tf.constant((1 << _HLL_BITS) - 1, dtype=tf.uint64)
    val = val & mask
    # Default: all zeros → _HLL_BITS + 1
    result = tf.fill(tf.shape(val), _HLL_BITS + 1)
    not_found = tf.equal(result, _HLL_BITS + 1)
    for i in range(_HLL_BITS):
        shift = tf.constant(_HLL_BITS - 1 - i, dtype=tf.uint64)
        bit = tf.cast((val >> shift) & tf.constant(1, dtype=tf.uint64), tf.int32)
        not_found = tf.equal(result, _HLL_BITS + 1)
        result = tf.where(not_found & tf.equal(bit, 1),
                         tf.fill(tf.shape(val), i + 1),
                         result)
    return result


def _hll_update(registers: tf.Variable, values: tf.Tensor) -> None:
    """Update HLL registers for a batch of int64 categorical values."""
    hashed = _mix64(tf.cast(values, tf.uint64))
    bucket = tf.cast(
        tf.bitwise.right_shift(hashed, tf.constant(_HLL_BITS, tf.uint64)), tf.int32
    )  # [B]
    rho_vals = _rho(hashed)  # [B]
    new_regs = tf.tensor_scatter_nd_max(
        registers, tf.expand_dims(bucket, 1), rho_vals
    )
    registers.assign(new_regs)


def _hll_cardinality(registers: tf.Tensor) -> int:
    m = float(_HLL_M)
    alpha = 0.7213 / (1.0 + 1.079 / m)
    harmonic = tf.reduce_sum(
        tf.math.pow(2.0, -tf.cast(registers, tf.float64))
    ).numpy()
    estimate = alpha * m * m / harmonic
    return max(0, int(round(estimate)))


# ── Welford helpers ───────────────────────────────────────────────────────────

def _welford_merge_batch(
    count: tf.Variable,
    mean: tf.Variable,
    M2: tf.Variable,
    min_v: tf.Variable,
    max_v: tf.Variable,
    batch: tf.Tensor,  # [B, n_num] float64
) -> None:
    """Chan's parallel Welford update for a batch (NaN-aware per feature)."""
    nan_mask = tf.math.is_nan(batch)                           # [B, n_num]
    valid = tf.where(nan_mask, tf.zeros_like(batch), batch)    # [B, n_num]

    n_b = tf.cast(
        tf.reduce_sum(tf.cast(~nan_mask, tf.int64), axis=0), tf.float64
    )  # [n_num]
    mean_b = tf.math.divide_no_nan(
        tf.reduce_sum(valid, axis=0), n_b
    )  # [n_num]
    dev = tf.where(nan_mask, tf.zeros_like(batch), batch - mean_b)
    M2_b = tf.reduce_sum(dev * dev, axis=0)                    # [n_num]

    _INF = tf.constant(1e38, dtype=tf.float64)
    min_b = tf.reduce_min(
        tf.where(nan_mask, tf.fill(tf.shape(batch), _INF), batch), axis=0
    )
    max_b = tf.reduce_max(
        tf.where(nan_mask, tf.fill(tf.shape(batch), -_INF), batch), axis=0
    )

    # Chan's merge
    n_a = tf.cast(count, tf.float64)
    n_ab = n_a + n_b
    delta = mean_b - mean
    new_mean = tf.math.divide_no_nan(n_a * mean + n_b * mean_b, n_ab)
    new_M2 = M2 + M2_b + delta * delta * tf.math.divide_no_nan(n_a * n_b, n_ab)

    count.assign(tf.cast(n_ab, tf.int64))
    mean.assign(new_mean)
    M2.assign(new_M2)
    min_v.assign(tf.minimum(min_v, min_b))
    max_v.assign(tf.maximum(max_v, max_b))


# ── Main profiler ─────────────────────────────────────────────────────────────

_CORR_THRESHOLD = 0.85


def profile_dataset(dataset_id: str) -> DataProfile:
    ds = load_dataset(dataset_id)
    spec = ds.element_spec

    numeric_feats = [k for k, v in spec.items() if v.dtype == tf.float32]
    cat_feats = [k for k, v in spec.items() if v.dtype != tf.float32]
    n_num = len(numeric_feats)
    n_cat = len(cat_feats)

    # ── Welford accumulators [n_num] ─────────────────────────────────────────
    wf_count = tf.Variable(tf.zeros([n_num], tf.int64))
    wf_mean = tf.Variable(tf.zeros([n_num], tf.float64))
    wf_M2 = tf.Variable(tf.zeros([n_num], tf.float64))
    wf_min = tf.Variable(tf.cast(tf.fill([n_num], 1e38), tf.float64))
    wf_max = tf.Variable(tf.cast(tf.fill([n_num], -1e38), tf.float64))
    nan_count_num = tf.Variable(tf.zeros([n_num], tf.int64))

    # ── Pearson running sums ─────────────────────────────────────────────────
    corr_sum_x = tf.Variable(tf.zeros([n_num], tf.float64))
    corr_sum_xx = tf.Variable(tf.zeros([n_num, n_num], tf.float64))
    corr_n = tf.Variable(0, dtype=tf.int64)

    # ── HLL registers [n_cat, _HLL_M] ────────────────────────────────────────
    hll_regs = [tf.Variable(tf.zeros([_HLL_M], tf.int32)) for _ in cat_feats]
    nan_count_cat = [tf.Variable(0, dtype=tf.int64) for _ in cat_feats]

    row_count = 0

    for batch in ds.batch(4096):
        batch_size = tf.shape(next(iter(batch.values())))[0]
        row_count += int(batch_size)

        # ── Numeric ──────────────────────────────────────────────────────────
        if n_num:
            mat = tf.cast(
                tf.stack([batch[f] for f in numeric_feats], axis=1), tf.float64
            )  # [B, n_num]
            nan_mask = tf.math.is_nan(mat)
            nan_count_num.assign_add(
                tf.reduce_sum(tf.cast(nan_mask, tf.int64), axis=0)
            )
            _welford_merge_batch(wf_count, wf_mean, wf_M2, wf_min, wf_max, mat)

            # Pearson: substitute 0 for NaN (matches ingest pipeline behaviour)
            clean = tf.where(nan_mask, tf.zeros_like(mat), mat)
            corr_sum_x.assign_add(tf.reduce_sum(clean, axis=0))
            corr_sum_xx.assign_add(
                tf.linalg.matmul(clean, clean, transpose_a=True)
            )
            corr_n.assign_add(tf.cast(batch_size, tf.int64))

        # ── Categorical ───────────────────────────────────────────────────────
        for i, feat in enumerate(cat_feats):
            vals = tf.cast(batch[feat], tf.int64)  # [B]
            is_oov = tf.equal(vals, 0)             # index 0 = OOV / null
            nan_count_cat[i].assign_add(tf.reduce_sum(tf.cast(is_oov, tf.int64)))
            _hll_update(hll_regs[i], vals)

    # ── Compute correlation matrix ────────────────────────────────────────────
    corr_dict: dict[str, dict[str, float]] = {}
    high_corr: dict[str, list[str]] = {f: [] for f in numeric_feats}

    if n_num >= 2 and corr_n > 0:
        n = tf.cast(corr_n, tf.float64)
        mu = corr_sum_x / n                                         # [n_num]
        cov = corr_sum_xx / n - tf.linalg.matmul(
            tf.expand_dims(mu, 1), tf.expand_dims(mu, 0)
        )                                                            # [n_num, n_num]
        std = tf.sqrt(tf.linalg.diag_part(cov))                     # [n_num]
        outer_std = tf.linalg.matmul(
            tf.expand_dims(std, 1), tf.expand_dims(std, 0)
        )
        corr_mat = (cov / tf.maximum(outer_std, 1e-12)).numpy()

        for i, fi in enumerate(numeric_feats):
            row: dict[str, float] = {}
            for j, fj in enumerate(numeric_feats):
                r = float(corr_mat[i, j])
                row[fj] = round(r, 6)
                if i != j and abs(r) > _CORR_THRESHOLD:
                    high_corr[fi].append(fj)
            corr_dict[fi] = row

    # ── Build FeatureStat list ────────────────────────────────────────────────
    features: list[FeatureStat] = []

    for idx, feat in enumerate(numeric_feats):
        cnt = int(wf_count[idx].numpy())
        null_c = int(nan_count_num[idx].numpy())
        variance_val = (
            float(wf_M2[idx].numpy()) / (cnt - 1) if cnt > 1 else 0.0
        )
        features.append(FeatureStat(
            name=feat,
            dtype="float32",
            mean=float(wf_mean[idx].numpy()) if cnt else None,
            variance=variance_val if cnt else None,
            min_val=float(wf_min[idx].numpy()) if cnt else None,
            max_val=float(wf_max[idx].numpy()) if cnt else None,
            null_count=null_c,
            null_pct=round(null_c / row_count * 100, 4) if row_count else 0.0,
            cardinality=None,
            high_correlation=high_corr.get(feat, []),
        ))

    for idx, feat in enumerate(cat_feats):
        null_c = int(nan_count_cat[idx].numpy())
        cardinality = _hll_cardinality(hll_regs[idx])
        features.append(FeatureStat(
            name=feat,
            dtype="int64",
            null_count=null_c,
            null_pct=round(null_c / row_count * 100, 4) if row_count else 0.0,
            cardinality=cardinality,
        ))

    return DataProfile(
        dataset_id=dataset_id,
        row_count=row_count,
        feature_count=len(features),
        features=features,
        correlation_matrix=corr_dict,
        narrative="",
        computed_at=datetime.now(timezone.utc),
    )


def correlation_matrix(dataset_id: str) -> dict[str, dict[str, float]]:
    """Return Pearson correlation matrix, flagging |r| > 0.85."""
    return profile_dataset(dataset_id).correlation_matrix
