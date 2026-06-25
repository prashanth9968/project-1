"""
Async SQLAlchemy engine + session factory.

DATABASE_URL is injected automatically by Railway when the Postgres
plugin is attached to the project.  The asyncpg driver is required;
we swap the scheme prefix at runtime.
"""

import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


def _build_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    # Railway gives postgresql://, asyncpg needs postgresql+asyncpg://
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


engine = create_async_engine(
    _build_url(),
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,   # detect stale connections
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attribute values accessible after commit
)


class Base(DeclarativeBase):
    pass
