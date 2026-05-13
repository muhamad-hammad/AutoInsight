from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

DATA_DIR = Path("data")


def save_dataset(df: pd.DataFrame, feature_spec: dict, path: str | Path) -> None:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path / "dataset.parquet", index=False)
    (path / "element_spec.json").write_text(json.dumps(feature_spec, indent=2))


def load_dataset(dataset_id: str) -> tuple[pd.DataFrame, dict]:
    path = DATA_DIR / dataset_id
    df = pd.read_parquet(path / "dataset.parquet")
    feature_spec = json.loads((path / "element_spec.json").read_text())
    return df, feature_spec
