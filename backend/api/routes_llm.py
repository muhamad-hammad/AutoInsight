from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os

from backend.pipeline import advisor

router = APIRouter()


class SetProviderRequest(BaseModel):
    provider: Optional[str] = None


@router.get("/llm/status")
def llm_status() -> dict:
    """Return status of available and active LLM providers."""
    return advisor.get_llm_status()


@router.post("/llm/provider")
def llm_set_provider(body: SetProviderRequest) -> dict:
    """Set the runtime LLM provider. Validates provider name and API key presence.

    To clear the runtime override, send {"provider": null}.
    """
    requested = body.provider.lower() if body.provider else None

    # Validate provider name if given
    if requested and requested not in advisor.LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown LLM provider '{requested}'. "
                f"Valid providers: {', '.join(advisor.LLM_PROVIDERS.keys())}"
            ),
        )

    # If a provider is requested, ensure the required env API key is present
    if requested:
        key_env = advisor.LLM_PROVIDERS[requested]["key_env"]
        if not os.environ.get(key_env):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Provider '{requested}' is not configured: missing environment variable '{key_env}'. "
                    "Set the API key in your environment and retry."
                ),
            )

    # Set runtime provider (None clears override)
    advisor.set_runtime_provider(requested)

    return advisor.get_llm_status()


@router.post("/llm/test")
def llm_test() -> dict:
    """Lightweight check: resolve the active provider and report resolved config (without revealing keys)."""
    resolved = advisor._resolve_provider()
    if not resolved:
        raise HTTPException(
            status_code=400,
            detail=(
                "No LLM provider resolved. Ensure LLM_PROVIDER is set or an API key exists in the deployed environment."
            ),
        )
    base_url, api_key, model = resolved
    return {"base_url": base_url, "model": model, "key_set": bool(api_key)}
