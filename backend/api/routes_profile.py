from __future__ import annotations

import asyncio
import json
import os
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from backend.models.profile import DataProfile, FeatureStat
from backend.pipeline.profiler import profile_dataset

router = APIRouter()


async def _generate_narrative(profile: DataProfile) -> str:
    """Call OpenAI to produce a one-paragraph plain-language summary."""
    try:
        from openai import AsyncOpenAI  # local import to keep profiler dependency-free

        lines = []
        for f in profile.features:
            if f.dtype == "float32":
                lines.append(
                    f"{f.name}: mean={f.mean:.4f}, var={f.variance:.4f}, "
                    f"min={f.min_val:.4f}, max={f.max_val:.4f}, "
                    f"null_pct={f.null_pct}%"
                )
            else:
                lines.append(
                    f"{f.name}: cardinality≈{f.cardinality}, null_pct={f.null_pct}%"
                )

        high_corr_pairs = [
            f"{a} ↔ {b}"
            for a, row in profile.correlation_matrix.items()
            for b, r in row.items()
            if a < b and abs(r) > 0.85
        ]

        prompt = (
            f"Dataset has {profile.row_count} rows and {profile.feature_count} features.\n"
            f"Feature summary:\n" + "\n".join(lines)
        )
        if high_corr_pairs:
            prompt += "\nHighly correlated pairs (|r|>0.85): " + ", ".join(high_corr_pairs)
        prompt += (
            "\n\nWrite a short paragraph (3-5 sentences) for a data analyst "
            "summarising data quality, notable distributions, and any correlation warnings."
        )

        client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        resp = await client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=256,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return ""


def _progress(stage: str, pct: int) -> dict:
    return {"event": "progress", "data": json.dumps({"stage": stage, "pct": pct})}


@router.get("/profile/{dataset_id}")
async def profile_stream(dataset_id: str) -> EventSourceResponse:
    async def _events() -> AsyncIterator[dict]:
        yield _progress("loading", 5)
        await asyncio.sleep(0)

        yield _progress("preprocessing", 20)
        await asyncio.sleep(0)

        loop = asyncio.get_event_loop()
        try:
            profile: DataProfile = await loop.run_in_executor(
                None, profile_dataset, dataset_id
            )
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail=f"Dataset {dataset_id!r} not found")

        yield _progress("stats", 70)
        await asyncio.sleep(0)

        narrative = await _generate_narrative(profile)
        profile = profile.model_copy(update={"narrative": narrative})

        yield _progress("llm_insight", 95)
        await asyncio.sleep(0)

        yield {
            "event": "done",
            "data": profile.model_dump_json(),
        }

    return EventSourceResponse(_events())
