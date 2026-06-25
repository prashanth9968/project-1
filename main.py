"""
TransactRank – FastAPI application entry point.
Tables are created automatically on first startup via the lifespan hook.
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import ranking, summary, transaction


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if they don't exist (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="TransactRank API",
    description=(
        "Financial transaction service with idempotent writes, "
        "PostgreSQL-backed concurrency safety, and a multi-factor leaderboard."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing_header(request: Request, call_next):
    t = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time"] = f"{time.perf_counter() - t:.4f}"
    return response


app.include_router(transaction.router)
app.include_router(summary.router)
app.include_router(ranking.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "TransactRank API",
        "version": "2.0.0",
        "storage": "PostgreSQL",
        "docs": "/docs",
    }


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "timestamp": time.time()}
