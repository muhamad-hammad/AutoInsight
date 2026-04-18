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
        .map(_parse_line_fn(record_defaults, all_cols), num_parallel_calls=tf.data.AUTOTUNE)
    )

    # Adapt normalization layers using one pass per numeric column
    for col in numeric_cols:
        col_ds = raw_ds.map(lambda row, c=col: row[c], num_parallel_calls=tf.data.AUTOTUNE)
        norm_layers[col].adapt(col_ds.batch(4096, drop_remainder=True))

    # Adapt string lookup layers
    for col in categorical_cols:
        col_ds = raw_ds.map(
            lambda row, c=col: tf.expand_dims(row[c], 0),
            num_parallel_calls=tf.data.AUTOTUNE,
        )
        lookup_layers[col].adapt(col_ds)

    def transform(row: dict[str, tf.Tensor]) -> dict[str, tf.Tensor]:
        out: dict[str, tf.Tensor] = {}
        for c in numeric_cols:
            t = tf.cast(row[c], tf.float32)
            t = tf.where(tf.math.is_nan(t), tf.zeros_like(t), t)
            t_batch = tf.expand_dims(t, 0)
            t_norm = norm_layers[c](t_batch)
            out[c] = tf.squeeze(t_norm, axis=[0, 1]) if len(t_norm.shape) > 1 else tf.squeeze(t_norm, axis=0)
        for c in categorical_cols:
            out[c] = lookup_layers[c](row[c])
        return out

    ds = raw_ds.map(transform, num_parallel_calls=tf.data.AUTOTUNE)
    return ds.shuffle(4096).prefetch(tf.data.AUTOTUNE)


def _is_numeric(dtype_str: str) -> bool:
    return any(t in dtype_str for t in ("int", "float"))


def _parse_line_fn(record_defaults: list, col_names: list[str]):
    def parse(line: tf.Tensor) -> dict[str, tf.Tensor]:
        fields = tf.io.decode_csv(line, record_defaults=record_defaults)
        return dict(zip(col_names, fields))
    return parse
