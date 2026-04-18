from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models.roadmap import ModelRoadmap
from backend.pipeline.advisor import (
    enrich_with_openai,
    inspect_spec,
    recommend,
)
from backend.pipeline.store import load_dataset

router = APIRouter()


class RecommendRequest(BaseModel):
    dataset_id: str
    target_col: str


@router.post("/recommend", response_model=list[ModelRoadmap])
async def recommend_models(body: RecommendRequest) -> list[ModelRoadmap]:
    try:
        ds = load_dataset(body.dataset_id)
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail=f"Dataset {body.dataset_id!r} not found")

    spec = ds.element_spec
    if body.target_col not in spec:
        raise HTTPException(
            status_code=422,
            detail=f"target_col {body.target_col!r} not found in dataset features",
        )

    feature_map = inspect_spec(spec, body.target_col)

    # Estimate row count (sample-based for speed)
    row_count = 0
    for batch in ds.batch(4096):
        first_val = next(iter(batch.values()))
        row_count += int(first_val.shape[0])

    # Detect target type from dtype; classify int targets by cardinality
    target_dtype = spec[body.target_col].dtype.name
    if "float" in target_dtype:
        target_type = "regression"
    else:
        unique_vals: set = set()
        for batch in ds.batch(4096).take(1):
            for v in batch[body.target_col].numpy().flatten():
                unique_vals.add(int(v))
        target_type = "binary" if len(unique_vals) <= 2 else (
            "multiclass" if len(unique_vals) <= 20 else "regression"
        )

    feature_map[body.target_col]["target_type"] = target_type

    roadmaps = recommend(feature_map, row_count=row_count)
    roadmaps = await enrich_with_openai(roadmaps, feature_map)
    return roadmaps
