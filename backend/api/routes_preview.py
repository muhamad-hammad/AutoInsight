from __future__ import annotations

import random
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_DIR = Path("data")


@router.get("/preview/{dataset_id}", response_model=list[dict])
def get_preview(dataset_id: str) -> list[dict]:
    raw_csv = DATA_DIR / dataset_id / "raw.csv"
    if not raw_csv.exists():
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id!r} not found")

    df = pd.read_csv(raw_csv)
    rows = df.where(pd.notna(df), None).to_dict(orient="records")
    return random.sample(rows, min(6, len(rows)))
