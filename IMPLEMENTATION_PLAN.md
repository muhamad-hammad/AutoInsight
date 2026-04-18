# Auto-Insight — Implementation Plan

Phased build plan derived from `AutoInsight_MISSION.docx`. Each phase lists scope, deliverables, acceptance checks, and a **self-contained prompt** you can paste into a fresh Claude session to continue work without re-explaining context.

---

## Core Constraints (apply to every phase)
- Pandas used **only once** (schema sniff in upload). After that: everything through `tf.data.Dataset`.
- No sklearn / numpy / scipy for stats — use `tf.linalg`, `tf.math`.
- TFRecord-on-disk persistence; FastAPI workers stay stateless.
- OpenAI calls isolated to `advisor.py` and `routes_profile.py` (narrative).
- Target stack: Python 3.11+, TensorFlow ≥ 2.18, FastAPI, Pydantic v2, Next.js (App Router), Playwright.

---

## Phase 0 — Project Bootstrap

**Scope:** repo skeleton, dependencies, env config.
**Deliverables:**
- Directory tree per MISSION spec (`backend/`, `frontend/`, `tests/`).
- `backend/requirements.txt`, `backend/main.py` (FastAPI app with CORS + health route).
- `.env.example` (`OPENAI_API_KEY`, `DATA_DIR`).
- `.github/workflows/ci.yml` skeleton.

**Prompt:**
```
You are working on Auto-Insight, an AutoML platform (FastAPI + TensorFlow 2.18
+ Next.js). Bootstrap the repo at d:/AutoInsight.

Create:
1. backend/ with main.py (FastAPI app, /health route, CORS for localhost:3000)
2. backend/requirements.txt: tensorflow>=2.18, fastapi, uvicorn[standard],
   python-multipart, openai, pydantic>=2, sse-starlette
3. backend/pipeline/__init__.py, backend/api/__init__.py, backend/models/__init__.py
4. .env.example with OPENAI_API_KEY, DATA_DIR=./data
5. Empty tests/ with conftest.py placeholder
6. .github/workflows/ci.yml running pytest on push

Do not implement any pipeline logic yet. Keep main.py minimal.
```

---

## Phase 1 — Ingestion & tf.data Pipeline (Sprint 1)

**Scope:** upload → schema sniff → tf.data build → TFRecord persist.
**Deliverables:**
- `backend/api/routes_upload.py` — `POST /api/upload`, returns `{dataset_id, schema}`.
- `backend/pipeline/ingest.py` — `build_dataset(csv_path, schema) -> tf.data.Dataset` using `TextLineDataset` + `tf.io.decode_csv` inside `.map()`, `Normalization` + `StringLookup` adapted, NaN handled with `tf.where`.
- `backend/pipeline/store.py` — `save_dataset`, `load_dataset`, element_spec round-trip.
- `backend/models/schema.py` — `DataSchema` pydantic.

**Acceptance:**
- Upload 50 MB CSV → returns `dataset_id` in < 3s, no Pandas DataFrame retained.
- `load_dataset(id).element_spec == saved element_spec`.

**Prompt:**
```
Auto-Insight project at d:/AutoInsight. Phase 0 done (FastAPI app + deps).
Implement Sprint 1 (ingestion).

Hard rule: Pandas used ONLY to sniff column names + dtypes via
pd.read_csv(path, nrows=0). After that no Pandas anywhere.

Build:
1. backend/api/routes_upload.py
   - POST /api/upload multipart file (.csv or .json, ≤100MB)
   - Save to {DATA_DIR}/{uuid}/raw.csv
   - Pandas nrows=0 → schema dict {col: dtype_str}, write spec.json
   - Return {dataset_id: uuid, schema}

2. backend/pipeline/ingest.py
   - build_dataset(csv_path: str, schema: dict) -> tf.data.Dataset
   - tf.data.TextLineDataset(skip header) + tf.io.decode_csv in .map()
   - Numeric cols: tf.keras.layers.Normalization (adapted on one pass)
   - Categorical cols: tf.keras.layers.StringLookup(output_mode='int', adapted)
   - NaN → tf.where(tf.math.is_nan(t), tf.zeros_like(t), t) inside .map()
   - Return ds.shuffle(4096).prefetch(tf.data.AUTOTUNE)

3. backend/pipeline/store.py
   - save_dataset(ds, path) → TFRecord + element_spec.json
   - load_dataset(dataset_id) → reconstruct ds from TFRecord + spec
   - Assert reconstructed element_spec equals saved

4. backend/models/schema.py — DataSchema pydantic

Register routes in main.py. Add unit test that round-trips element_spec.
```

---

## Phase 2 — Streaming Profiler + SSE (Sprint 2)

**Scope:** single-pass Welford stats, HLL cardinality, correlation, SSE endpoint, OpenAI narrative.
**Deliverables:**
- `backend/pipeline/profiler.py` — `profile_dataset(dataset_id) -> DataProfile`, `correlation_matrix(...)` (tf.linalg only).
- `backend/api/routes_profile.py` — `GET /api/profile/{id}` SSE emitting stages `loading→preprocessing→stats→llm_insight→done`.
- `backend/models/profile.py` — `FeatureStat`, `DataProfile` pydantic.

**Acceptance:**
- Exactly one iteration over `tf.data` (verify with a counting wrapper in tests).
- `|r| > 0.85` flagged in output.
- SSE stream produces all 5 stage events; final event includes narrative string.

**Prompt:**
```
Auto-Insight at d:/AutoInsight. Phases 0-1 done: upload + ingest + store
work; load_dataset(id) yields tf.data.Dataset with known element_spec.
Implement Sprint 2 (profiling + SSE).

No Pandas, no numpy, no scipy. Only tf.linalg / tf.math.

Build:
1. backend/models/profile.py
   FeatureStat(name, dtype, mean?, variance?, min_val?, max_val?,
     null_count, null_pct, cardinality?, high_correlation: list[str])
   DataProfile(dataset_id, row_count, feature_count, features,
     correlation_matrix: dict, narrative: str, computed_at)

2. backend/pipeline/profiler.py
   - profile_dataset(dataset_id) -> DataProfile
     * Single pass over load_dataset(id)
     * Welford update per numeric feature (mean, variance, min, max)
     * tf.math.is_nan accumulator for nulls
     * HyperLogLog cardinality for categoricals using pure TF bitwise ops
   - correlation_matrix(dataset_id): Pearson via tf.linalg.matmul on
     running sums, flag |r|>0.85

3. backend/api/routes_profile.py
   - GET /api/profile/{id} returns sse_starlette EventSourceResponse
   - Yield JSON events at stages: loading(5), preprocessing(20),
     stats(70), llm_insight(95), done(100)
   - After stats: call OpenAI chat.completions with feature summary,
     request a short narrative paragraph. Isolate to one helper.
   - Final event: {type:"done", data: DataProfile + narrative}

4. Tests: patch iterator to count passes (assert 1), tiny CSV Welford
   accuracy vs hand-computed mean/variance.
```

---

## Phase 3 — Recommendation Engine (Sprint 3)

**Scope:** element_spec → FeatureMap → ranked `ModelRoadmap[]`, OpenAI rationale + Keras snippet.
**Deliverables:**
- `backend/pipeline/advisor.py` — `inspect_spec`, `recommend`, `enrich_with_openai`.
- `backend/api/routes_recommend.py` — `POST /api/recommend` `{dataset_id, target_col}`.
- `backend/models/roadmap.py` — `ModelRoadmap` pydantic.

**Rule engine (from spec):**
- all numeric + regression → Deep MLP regressor
- mixed num+cat + binary/multiclass → Wide & Deep
- high-cardinality categoricals → embeddings + MLP
- sequence/time features → 1D-CNN or LSTM stub
- small dataset (<5k rows) → shallow MLP
- high feature correlation → add dropout/L2 note

**Acceptance:**
- Returns top 3 ranked by confidence (0.0–1.0).
- Rank-1 includes `rationale` + runnable `keras_snippet`.
- Target type detected: binary (2 uniq), multiclass (≤20), regression (float).

**Prompt:**
```
Auto-Insight at d:/AutoInsight. Phases 0-2 done: load_dataset(id) returns
a tf.data.Dataset whose element_spec encodes numeric vs categorical
features. DataProfile available via profiler. Implement Sprint 3.

Build:
1. backend/models/roadmap.py
   ModelRoadmap(rank, model_type, architecture_summary,
     keras_layers: list[str], confidence: float, rationale: str,
     keras_snippet: str, target_type: str)

2. backend/pipeline/advisor.py
   - inspect_spec(element_spec, target_col) -> FeatureMap
     Classify each feature as numeric | categorical | target.
     Detect target_type: binary(2 uniq), multiclass(<=20), regression(float).
   - recommend(feature_map) -> list[ModelRoadmap]  (top 3, ranked by confidence)
     Apply rule engine in precedence order:
       all-numeric+regression → Deep MLP
       mixed + classification → Wide & Deep
       high-cardinality cats → Embeddings + MLP
       sequence/time → 1D-CNN or LSTM
       small dataset (<5k rows) → shallow MLP
       high correlation flag → note dropout/L2
   - enrich_with_openai(roadmaps, feature_map) -> list[ModelRoadmap]
     Call OpenAI chat with system "You are a TensorFlow model architect."
     Request JSON {rationale, keras_snippet}. Inject into roadmaps[0].

3. backend/api/routes_recommend.py
   POST /api/recommend {dataset_id, target_col} -> list[ModelRoadmap]

4. Tests covering all 6 rule conditions; mock OpenAI client.
```

---

## Phase 4 — Frontend Workspace + SSE Hook (Sprint 4a)

**Scope:** Next.js Analysis Workspace UI wired to backend.
**Deliverables:**
- `frontend/hooks/useProfile.ts` — EventSource client, exposes `{progress, profile, status, error}`. ✅
- `frontend/app/workspace/page.tsx` — layout: `UploadDropzone | ProgressBar | DataGrid | ProfileCharts | RoadmapCard`. ✅
- Components: `UploadDropzone`, `ProgressBar`, `DataGrid`, `ProfileCharts`, `RoadmapCard`. ✅
- `backend/api/routes_preview.py` — `GET /api/preview/{id}` returns first 200 rows (streamed from tf.data, decoded).
- `frontend/app/page.tsx` — redirect root `/` to `/workspace` so the app is immediately accessible. ❌ (currently shows default Next.js template)
- `frontend/lib/types.ts` — `FeatureStat`, `DataProfile`, `ModelRoadmap` shared types. ✅

**Acceptance:**
- Visiting `http://localhost:3000` lands on the workspace (not the Next.js default page).
- Upload → progress bar animates through all 5 stages → DataGrid + charts + RoadmapCard render.
- Null cells highlighted amber; keras snippet copy button works.

**Remaining work:**
1. Replace `frontend/app/page.tsx` with a redirect to `/workspace` (one line: `redirect('/workspace')`).
2. Verify `ProfileCharts` and `DataGrid` components render without errors once a real dataset is uploaded.

**Prompt:**
```
Auto-Insight at d:/AutoInsight. Backend phases 1-3 complete. All endpoints
working: POST /api/upload, GET /api/profile/{id} (SSE), POST /api/recommend.
Add GET /api/preview/{id} (first 200 rows via tf.data take(200), decoded
to list[dict]) in backend/api/routes_preview.py.

Then build the Next.js frontend (App Router, TypeScript, Tailwind, Recharts):

1. frontend/hooks/useProfile.ts
   - Open EventSource(/api/profile/{datasetId})
   - Parse events {stage, pct, message, data?}
   - Expose {progress: {stage, pct, message}, profile, status, error}
   - Handle error/close; cleanup on unmount

2. frontend/app/workspace/page.tsx — sections in order:
   UploadDropzone (drag-drop .csv/.json, max 100MB, client validation)
   → ProgressBar (useProfile, stage label + pct)
   → DataGrid (200 rows from /api/preview, sortable, null cells amber)
   → ProfileCharts (histogram per numeric via Recharts, null heatmap,
     correlation colour matrix)
   → RoadmapCard (top 3 models, expandable keras snippet + copy button)

3. Components under frontend/components/. Keep props minimal and typed.

Use data-testid on the key elements (upload-dropzone, progress-bar,
data-grid, roadmap-card, keras-snippet) for Playwright in Phase 5.
```

---

## Phase 5 — Testing & Hardening (Sprint 4b)

**Scope:** pytest suite, memory budget, Playwright E2E, CI.
**Deliverables:**
- `tests/conftest.py` — fixtures: `small_csv`(1K), `medium_csv`(100K), `all_null_col_csv`, `cat_only_csv`.
- `tests/test_pipeline.py` — unit + integration covering ingest/profiler/advisor.
- Memory test: `tracemalloc` on 50 MB fixture, assert peak < 512 MB.
- `tests/e2e.spec.ts` — Playwright happy path.
- CI: pytest + Playwright green on push.

**Acceptance:**
- All acceptance criteria from Sprints 1–4 green.
- Peak RSS < 512 MB on 50 MB CSV end-to-end.
- No console errors during E2E run.

**Prompt:**
```
Auto-Insight at d:/AutoInsight. All features (phases 1-4) implemented.
Harden with tests.

Build:
1. tests/conftest.py fixtures:
   - small_csv (1K rows, mixed num+cat)
   - medium_csv (100K rows)
   - all_null_col_csv (one column entirely NaN)
   - cat_only_csv (all categorical)
   - fixture_50mb_csv for memory test

2. tests/test_pipeline.py:
   - ingest: element_spec matches schema; all-null col → zeros;
     categorical col → int tensor after StringLookup
   - profiler: patch the tf.data iterator to count passes, assert == 1;
     Welford mean/variance vs hand-computed on small_csv
   - advisor: each of the 6 rule conditions hits the expected model_type
   - integration: CSV path → upload → profile → recommend end-to-end
     (OpenAI mocked); assert DataProfile + ModelRoadmap field types
   - memory: tracemalloc over full pipeline on fixture_50mb_csv,
     assert peak_mb < 512

3. tests/e2e.spec.ts (Playwright):
   - Upload fixture.csv via UploadDropzone
   - Wait for progress bar to reach 100%
   - Assert data-testid=roadmap-card visible, keras-snippet non-empty
   - Assert data-grid shows >= 5 rows
   - Assert no console errors

4. Update .github/workflows/ci.yml to run pytest + npx playwright test.
```

---

## Phase Ordering & Dependencies

| Phase | Depends on | Can parallelize |
|---|---|---|
| 0 Bootstrap | — | — |
| 1 Ingest | 0 | — |
| 2 Profiler+SSE | 1 | — |
| 3 Recommender | 1 (spec only) | can start after Phase 1 in parallel with Phase 2 |
| 4 Frontend | 2, 3 | — |
| 5 Tests | 4 | unit tests can begin during Phase 2/3 |

---

## Non-Negotiable Checklist (verify before shipping each phase)
- [ ] No `import pandas` outside `routes_upload.py`
- [ ] No `import numpy` / `scipy` / `sklearn` in pipeline code
- [ ] All stats via `tf.linalg` / `tf.math`
- [ ] `element_spec` round-trips through TFRecord store
- [ ] OpenAI calls only in `advisor.py` and narrative helper in `routes_profile.py`
- [ ] Peak RSS < 512 MB on 50 MB fixture
