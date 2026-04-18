import json
import uuid
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException, UploadFile

from backend.models.schema import DataSchema

DATA_DIR = Path("data")
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

router = APIRouter()


@router.post("/upload", response_model=DataSchema)
async def upload_file(file: UploadFile) -> DataSchema:
    if file.content_type not in ("text/csv", "application/json") and not (
        file.filename.endswith(".csv") or file.filename.endswith(".json")
    ):
        raise HTTPException(status_code=400, detail="Only .csv or .json files accepted")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")

    dataset_id = str(uuid.uuid4())
    dataset_dir = DATA_DIR / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)

    raw_path = dataset_dir / "raw.csv"
    raw_path.write_bytes(contents)

    try:
        df_empty = pd.read_csv(raw_path, nrows=0)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not parse CSV: {exc}") from exc

    schema = {col: str(dtype) for col, dtype in df_empty.dtypes.items()}

    spec_path = dataset_dir / "spec.json"
    spec_path.write_text(json.dumps(schema, indent=2))

    return DataSchema(dataset_id=dataset_id, schema=schema)
