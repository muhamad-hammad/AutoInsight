# AutoInsight

An AutoML platform that takes a raw CSV, profiles it with a single streaming pass, and recommends ranked TensorFlow model architectures — all without leaving your browser.

**Stack:** Python 3.11 · TensorFlow ≥ 2.18 · FastAPI · Pydantic v2 · Next.js 14 (App Router) · Recharts · Playwright · OpenAI / Anthropic (runtime-switchable)

## Live Demo

**[https://autoinsight-mh.vercel.app/](https://autoinsight-mh.vercel.app/)**

> The live deployment serves the Next.js frontend. To use the full pipeline (upload, profile, recommend), you'll need the backend running locally and `NEXT_PUBLIC_API_URL` pointed at it.

---

## Architecture

```
frontend/          Next.js UI (TypeScript, Tailwind, Recharts)
backend/
  api/             FastAPI route handlers
  pipeline/        ingest · profiler · advisor · store
  models/          Pydantic schemas
tests/             pytest unit/integration + Playwright E2E
```

### Key design constraints
- Pandas used **only once** — schema sniff on upload (`nrows=0`). All downstream processing is `tf.data`.
- No NumPy / SciKit-Learn / SciPy in pipeline code. Stats via `tf.linalg` / `tf.math` (Welford, HLL, Pearson).
- TFRecord-on-disk persistence; FastAPI workers are stateless.
- LLM provider is runtime-switchable (OpenAI ↔ Anthropic) via `POST /api/llm/provider`; calls isolated to `advisor.py` and `routes_profile.py`.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/api/upload` | Upload CSV (≤ 500 MB) → `{dataset_id, schema}` |
| `GET` | `/api/preview/{id}` | First 200 rows decoded to `list[dict]` |
| `GET` | `/api/profile/{id}` | SSE stream → 5 stages → `DataProfile` + narrative |
| `POST` | `/api/recommend` | `{dataset_id, target_col}` → top-3 `ModelRoadmap[]` |
| `GET` | `/api/llm/status` | Active LLM provider + model info |
| `POST` | `/api/llm/provider` | `{provider}` — switch between `"openai"` / `"anthropic"` / `null` (env default) |

SSE stages: `loading(5%) → preprocessing(20%) → stats(70%) → llm_insight(95%) → done(100%)`

---

## Getting started

### 1. Environment

```bash
cp .env.example .env
# fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, and DATA_DIR
# LLM_PROVIDER=openai|anthropic  (default: openai)
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn backend.main:app --reload
# → http://localhost:8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Tests

```bash
# Unit + integration (pytest)
pytest tests/ -v

# E2E (requires both servers running)
npx playwright test
```

CI runs both suites on every push via `.github/workflows/ci.yml`.

---

## Model recommendation rules

| Condition | Recommended architecture |
|-----------|--------------------------|
| All numeric + regression target | Deep MLP regressor |
| Mixed num+cat + classification | Wide & Deep |
| High-cardinality categoricals | Embeddings + MLP |
| Sequence / time features | 1D-CNN or LSTM |
| Small dataset (< 5k rows) | Shallow MLP |
| High feature correlation (&#124;r&#124; > 0.85) | Add dropout / L2 note |

The rank-1 recommendation is enriched with an OpenAI-generated rationale and a runnable Keras snippet.
