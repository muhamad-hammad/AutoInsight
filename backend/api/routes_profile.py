from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from backend.models.profile import DataProfile
from backend.pipeline.profiler import DATA_DIR, profile_dataset

router = APIRouter()


async def _generate_narrative(
    profile: DataProfile, 
    llm_provider: str | None = None, 
    llm_key: str | None = None
) -> str:
    """Generate a plain-language summary using configured LLM."""
    lines = []
    for f in profile.features:
        if f.dtype == "float32":
            parts = [f"null_pct={f.null_pct}%"]
            if f.mean is not None:
                parts = [f"mean={f.mean:.4f}", f"var={f.variance:.4f}",
                         f"min={f.min_val:.4f}", f"max={f.max_val:.4f}"] + parts
            lines.append(f"{f.name}: {', '.join(parts)}")
        else:
            lines.append(f"{f.name}: cardinality≈{f.cardinality}, null_pct={f.null_pct}%")

    high_corr_pairs = [
        f"{a} ↔ {b}"
        for a, row in profile.correlation_matrix.items()
        for b, r in row.items()
        if a < b and abs(r) > 0.85
    ]

    prompt = (
        f"Dataset has {profile.row_count} rows and {profile.feature_count} features.\n"
        "Feature summary:\n" + "\n".join(lines)
    )
    if high_corr_pairs:
        prompt += "\nHighly correlated pairs (|r|>0.85): " + ", ".join(high_corr_pairs)
    prompt += (
        "\n\nWrite a short paragraph (3-5 sentences) for a data analyst "
        "summarising data quality, notable distributions, and any correlation warnings."
    )

    from backend.pipeline.advisor import LLM_PROVIDERS, enrich_with_openai
    
    config_override = None
    if llm_provider and llm_key:
        cfg = LLM_PROVIDERS.get(llm_provider.lower())
        if cfg:
            config_override = {
                "base_url": cfg["base_url"],
                "api_key": llm_key,
                "model": cfg["default_model"],
            }
    
    # Use enrich_with_openai's logic via a dummy roadmap if we want to reuse the helper,
    # but it's better to just call the API here.
    # For now, let's just use the config to call OpenAI-compatible API.
    
    base_url = "https://api.openai.com/v1"
    api_key = os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    if config_override:
        base_url = config_override["base_url"]
        api_key = config_override["api_key"]
        model = config_override["model"]
    
    if api_key:
        try:
            import httpx
            timeout_seconds = float(os.environ.get("LLM_REQUEST_TIMEOUT", "10"))
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 300,
                        "temperature": 0.3,
                    },
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip()
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.WriteTimeout, httpx.TimeoutException):
            # LLM timed out or connection lost — return a short explanatory string
            return "(LLM timeout: try increasing server timeout or set LLM_REQUEST_TIMEOUT to a higher value)"
        except Exception:
            pass

    # Fallback to Ollama if no key provided
    try:
        import aiohttp
        ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{ollama_url}/api/generate",
                json={"model": os.environ.get("OLLAMA_MODEL", "llama3"),
                      "prompt": prompt, "stream": False},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                result = await resp.json()
                return result.get("response", "").strip()
    except Exception:
        pass

    return ""


def _progress(stage: str, pct: int) -> dict:
    return {"event": "progress", "data": json.dumps({"stage": stage, "pct": pct})}


@router.get("/profile/{dataset_id}")
async def profile_stream(
    dataset_id: str, 
    llm_provider: str | None = None, 
    llm_key: str | None = None
) -> EventSourceResponse:
    async def _events() -> AsyncIterator[dict]:
        try:
            yield _progress("loading", 5)
            await asyncio.sleep(0)

            if not (DATA_DIR / dataset_id / "raw.csv").exists():
                raise FileNotFoundError(f"Dataset {dataset_id!r} not found")

            yield _progress("preprocessing", 20)
            await asyncio.sleep(0)

            loop = asyncio.get_running_loop()
            profile: DataProfile = await loop.run_in_executor(
                None, profile_dataset, dataset_id
            )

            yield _progress("stats", 70)
            await asyncio.sleep(0)

            narrative = await _generate_narrative(profile, llm_provider, llm_key)
            profile = profile.model_copy(update={"narrative": narrative})

            yield _progress("llm_insight", 95)
            await asyncio.sleep(0)

            yield {"event": "done", "data": profile.model_dump_json()}
        except Exception as exc:
            yield {"event": "failure", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(_events())
