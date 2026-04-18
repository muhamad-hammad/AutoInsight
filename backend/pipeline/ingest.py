from __future__ import annotations

import tensorflow as tf


def build_dataset(csv_path: str, schema: dict[str, str]) -> tf.data.Dataset:
    numeric_cols = [c for c, d in schema.items() if _is_numeric(d)]
    categorical_cols = [c for c, d in schema.items() if not _is_numeric(d)]
    all_cols = list(schema.keys())

    record_defaults = [
        0.0 if _is_numeric(schema[c]) else "" for c in all_cols
    ]

    col_index = {c: i for i, c in enumerate(all_cols)}

    # Build adapters
    norm_layers: dict[str, tf.keras.layers.Normalization] = {}
    lookup_layers: dict[str, tf.keras.layers.StringLookup] = {}

    for col in numeric_cols:
        norm_layers[col] = tf.keras.layers.Normalization(axis=None)
    for col in categorical_cols:
        lookup_layers[col] = tf.keras.layers.StringLookup(output_mode="int")

    raw_ds = (
        tf.data.TextLineDataset(csv_path)
        .skip(1)  # skip header
        .map(_parse_line_fn(record_defaults), num_parallel_calls=tf.data.AUTOTUNE)
    )

    # Adapt normalization layers using one pass per numeric column
    for col in numeric_cols:
        idx = col_index[col]
        col_ds = raw_ds.map(lambda row, i=idx: row[i], num_parallel_calls=tf.data.AUTOTUNE)
        norm_layers[col].adapt(col_ds.batch(4096))

    # Adapt string lookup layers
    for col in categorical_cols:
        idx = col_index[col]
        col_ds = raw_ds.map(
            lambda row, i=idx: tf.expand_dims(row[i], 0),
            num_parallel_calls=tf.data.AUTOTUNE,
        )
        lookup_layers[col].adapt(col_ds)

    def transform(row: list[tf.Tensor]) -> dict[str, tf.Tensor]:
        out: dict[str, tf.Tensor] = {}
        for col in numeric_cols:
            idx = col_index[col]
            t = tf.cast(row[idx], tf.float32)
            t = tf.where(tf.math.is_nan(t), tf.zeros_like(t), t)
            out[col] = norm_layers[col](t)
        for col in categorical_cols:
            idx = col_index[col]
            out[col] = lookup_layers[col](row[idx])
        return out

    ds = raw_ds.map(transform, num_parallel_calls=tf.data.AUTOTUNE)
    return ds.shuffle(4096).prefetch(tf.data.AUTOTUNE)


def _is_numeric(dtype_str: str) -> bool:
    return any(t in dtype_str for t in ("int", "float"))


def _parse_line_fn(record_defaults: list):
    def parse(line: tf.Tensor) -> list[tf.Tensor]:
        fields = tf.io.decode_csv(line, record_defaults=record_defaults)
        return fields
    return parse
