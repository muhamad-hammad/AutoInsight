from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes_preview import router as preview_router
from backend.api.routes_profile import router as profile_router
from backend.api.routes_recommend import router as recommend_router
from backend.api.routes_upload import router as upload_router

app = FastAPI(title="AutoInsight")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router, prefix="/api")
app.include_router(preview_router, prefix="/api")
app.include_router(profile_router, prefix="/api")
app.include_router(recommend_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
