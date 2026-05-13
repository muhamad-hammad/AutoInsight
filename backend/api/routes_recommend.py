from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models.roadmap import ModelRoadmap
from backend.pipeline.advisor import (
    enrich_with_openai,
    inspect_spec,
    recommend,
    LLM_PROVIDERS,
)
from backend.pipeline.store import DATA_DIR, load_dataset

router = APIRouter()


class RecommendRequest(BaseModel):
    dataset_id: str
    target_col: str
    llm_provider: str | None = None
    llm_key: str | None = None


def _ensure_parquet(dataset_id: str) -> None:
    dataset_dir = DATA_DIR / dataset_id
    if (dataset_dir / "dataset.parquet").exists():
        return
    spec_path = dataset_dir / "spec.json"
    if not spec_path.exists():
        raise FileNotFoundError(f"Schema for {dataset_id!r} not found")
    schema = json.loads(spec_path.read_text())
    from backend.pipeline.ingest import build_dataset
    from backend.pipeline.store import save_dataset
    df, feature_spec = build_dataset(str(dataset_dir / "raw.csv"), schema)
    save_dataset(df, feature_spec, dataset_dir)


@router.post("/recommend", response_model=list[ModelRoadmap])
async def recommend_models(body: RecommendRequest) -> list[ModelRoadmap]:
    dataset_dir = DATA_DIR / body.dataset_id
    if not dataset_dir.exists() or not (dataset_dir / "raw.csv").exists():
        raise HTTPException(status_code=404, detail=f"Dataset {body.dataset_id!r} not found")

    import asyncio
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _ensure_parquet, body.dataset_id)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    try:
        df, feature_spec = load_dataset(body.dataset_id)
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail=f"Dataset {body.dataset_id!r} not found")

    if body.target_col not in feature_spec:
        raise HTTPException(
            status_code=422,
            detail=f"target_col {body.target_col!r} not found in dataset features",
        )

    feature_map = inspect_spec(feature_spec, body.target_col)
    row_count = len(df)

    target_dtype = feature_spec[body.target_col]["dtype"]
    if "float" in target_dtype:
        target_type = "regression"
    else:
        unique_vals = set(df[body.target_col].dropna().astype(int).unique().tolist())
        target_type = "binary" if len(unique_vals) <= 2 else (
            "multiclass" if len(unique_vals) <= 20 else "regression"
        )

    feature_map[body.target_col]["target_type"] = target_type

    roadmaps = recommend(feature_map, row_count=row_count)

    config_override = None
    if body.llm_provider and body.llm_key:
        cfg = LLM_PROVIDERS.get(body.llm_provider.lower())
        if cfg:
            config_override = {
                "base_url": cfg["base_url"],
                "api_key": body.llm_key,
                "model": cfg["default_model"],
            }

    roadmaps = await enrich_with_openai(roadmaps, feature_map, config_override=config_override)
    return roadmaps
