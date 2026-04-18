from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FeatureStat(BaseModel):
    name: str
    dtype: str
    mean: Optional[float] = None
    variance: Optional[float] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    null_count: int
    null_pct: float
    cardinality: Optional[int] = None
    high_correlation: list[str] = Field(default_factory=list)


class DataProfile(BaseModel):
    dataset_id: str
    row_count: int
    feature_count: int
    features: list[FeatureStat]
    correlation_matrix: dict[str, dict[str, float]]
    narrative: str
    computed_at: datetime
