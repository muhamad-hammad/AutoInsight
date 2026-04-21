from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from backend.models.profile import DataProfile, FeatureStat

DATA_DIR = Path("data")

_CORR_THRESHOLD = 0.85


def profile_dataset(dataset_id: str) -> DataProfile:
    raw = DATA_DIR / dataset_id / "raw.csv"
    df = pd.read_csv(raw)

    row_count = len(df)
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    cat_cols = df.select_dtypes(exclude="number").columns.tolist()

    # Pearson correlation matrix for numeric features
    corr_dict: dict[str, dict[str, float]] = {}
    high_corr_map: dict[str, list[str]] = {c: [] for c in numeric_cols}
    if len(numeric_cols) >= 2:
        corr_df = df[numeric_cols].corr()
        for fi in numeric_cols:
            row_d: dict[str, float] = {}
            for fj in numeric_cols:
                r = float(corr_df.loc[fi, fj])
                val = round(r, 6) if not math.isnan(r) else 0.0
                row_d[fj] = val
                if fi != fj and abs(val) > _CORR_THRESHOLD:
                    high_corr_map[fi].append(fj)
            corr_dict[fi] = row_d

    features: list[FeatureStat] = []

    for col in numeric_cols:
        s = df[col]
        null_c = int(s.isna().sum())
        valid = s.dropna()
        cnt = len(valid)
        features.append(FeatureStat(
            name=col,
            dtype="float32",
            mean=float(valid.mean()) if cnt else None,
            variance=float(valid.var()) if cnt > 1 else None,
            min_val=float(valid.min()) if cnt else None,
            max_val=float(valid.max()) if cnt else None,
            null_count=null_c,
            null_pct=round(null_c / row_count * 100, 4) if row_count else 0.0,
            cardinality=None,
            high_correlation=high_corr_map.get(col, []),
        ))

    for col in cat_cols:
        s = df[col]
        null_c = int(s.isna().sum())
        features.append(FeatureStat(
            name=col,
            dtype="int64",
            null_count=null_c,
            null_pct=round(null_c / row_count * 100, 4) if row_count else 0.0,
            cardinality=int(s.nunique()),
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
