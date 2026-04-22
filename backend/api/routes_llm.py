from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.pipeline.advisor import get_llm_status, set_runtime_provider

router = APIRouter()


class SetProviderRequest(BaseModel):
    provider: str | None


@router.get("/llm/status")
def llm_status() -> dict:
    return get_llm_status()


@router.post("/llm/provider")
def llm_set_provider(body: SetProviderRequest) -> dict:
    set_runtime_provider(body.provider)
    return get_llm_status()
