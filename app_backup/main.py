"""
TransactRank – main FastAPI application.

Run locally:
    uvicorn app.main:app --reload

Auto-generated docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ranking, summary, transaction

app = FastAPI(
    title="TransactRank API",
    description=(
        "Financial transaction service with multi-factor user ranking.\n\n"
        "Highlights: idempotent transactions · per-user rate limiting · "
        "safe concurrent balance updates · three-factor leaderboard."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow all origins so the standalone frontend can reach the API.
# Tighten this in production by listing specific origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ── Middleware ─────────────────────────────────────────────────────────────────
@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = round(time.perf_counter() - start, 4)
    response.headers["X-Process-Time"] = str(elapsed)
    return response


# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(transaction.router)
app.include_router(summary.router)
app.include_router(ranking.router)


# ── Utility endpoints ──────────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "TransactRank API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": ["POST /transaction", "GET /summary/{user_id}", "GET /ranking"],
    }


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "timestamp": time.time()}
