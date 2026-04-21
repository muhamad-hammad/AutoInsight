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


async def _generate_narrative(profile: DataProfile) -> str:
    """Generate a plain-language summary using OpenAI (preferred) or Ollama."""
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

    if os.environ.get("OPENAI_API_KEY"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI()
            resp = await client.chat.completions.create(
                model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.3,
            )
            return resp.choices[0].message.content.strip()
        except Exception:
            pass

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
async def profile_stream(dataset_id: str) -> EventSourceResponse:
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

            narrative = await _generate_narrative(profile)
            profile = profile.model_copy(update={"narrative": narrative})

            yield _progress("llm_insight", 95)
            await asyncio.sleep(0)

            yield {"event": "done", "data": profile.model_dump_json()}
        except Exception as exc:
            yield {"event": "failure", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(_events())
