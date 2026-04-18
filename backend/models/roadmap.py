from __future__ import annotations

from pydantic import BaseModel, Field


class ModelRoadmap(BaseModel):
    rank: int
    model_type: str
    architecture_summary: str
    keras_layers: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str
    keras_snippet: str
    target_type: str
