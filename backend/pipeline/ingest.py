from __future__ import annotations

import pandas as pd


def build_dataset(csv_path: str, schema: dict[str, str]) -> tuple[pd.DataFrame, dict[str, dict]]:
    numeric_cols = [c for c, d in schema.items() if _is_numeric(d)]
    cat_cols = [c for c, d in schema.items() if not _is_numeric(d)]

    df = pd.read_csv(csv_path)

    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
        std = df[col].std()
        if std > 0:
            df[col] = (df[col] - df[col].mean()) / std
        df[col] = df[col].astype("float32")

    for col in cat_cols:
        df[col] = df[col].astype("category").cat.codes.astype("int32")

    feature_spec = {}
    for col in numeric_cols:
        feature_spec[col] = {"dtype": "float32"}
    for col in cat_cols:
        feature_spec[col] = {"dtype": "int32"}

    return df, feature_spec


def _is_numeric(dtype_str: str) -> bool:
    return any(t in dtype_str for t in ("int", "float"))
