from __future__ import annotations

import csv
import io
from pathlib import Path

import tensorflow as tf
from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_DIR = Path("data")


@router.get("/preview/{dataset_id}", response_model=list[dict])
def get_preview(dataset_id: str) -> list[dict]:
    raw_csv = DATA_DIR / dataset_id / "raw.csv"
    if not raw_csv.exists():
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id!r} not found")

    # Read header separately so we know column names
    lines_ds = tf.data.TextLineDataset(str(raw_csv))
    header_tensor = next(iter(lines_ds.take(1)))
    columns = [c.strip() for c in header_tensor.numpy().decode("utf-8").split(",")]

    rows: list[dict] = []
    for line_tensor in lines_ds.skip(1).take(200):
        raw_line = line_tensor.numpy().decode("utf-8")
        # Use csv.reader to handle quoted fields correctly
        values = next(csv.reader(io.StringIO(raw_line)))
        row: dict = {}
        for col, val in zip(columns, values):
            v = val.strip()
            if v == "" or v.lower() in ("nan", "null", "none", "na", "n/a"):
                row[col] = None
            else:
                try:
                    row[col] = int(v)
                except ValueError:
                    try:
                        row[col] = float(v)
                    except ValueError:
                        row[col] = v
        rows.append(row)

    return rows
