import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes_llm import router as llm_router
from backend.api.routes_preview import router as preview_router
from backend.api.routes_profile import router as profile_router
from backend.api.routes_recommend import router as recommend_router
from backend.api.routes_upload import router as upload_router

app = FastAPI(title="AutoInsight")

_origins = ["http://localhost:3000"]
_extra = os.getenv("CORS_ORIGINS", "")
if _extra:
    _origins.extend(o.strip() for o in _extra.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router, prefix="/api")
app.include_router(preview_router, prefix="/api")
app.include_router(profile_router, prefix="/api")
app.include_router(recommend_router, prefix="/api")
app.include_router(llm_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
