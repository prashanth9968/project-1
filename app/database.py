"""
Async SQLAlchemy engine + session factory.

DATABASE_URL is injected automatically by Railway when the Postgres
plugin is attached to the project.  The asyncpg driver is required;
we swap the scheme prefix at runtime.
"""

import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


import urllib.parse

def _get_engine():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    
    # Railway gives postgresql://, asyncpg needs postgresql+asyncpg://
    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    parsed = urllib.parse.urlparse(url)
    query_params = urllib.parse.parse_qs(parsed.query)
    
    connect_args = {}
    if "sslmode" in query_params:
        sslmode = query_params.pop("sslmode")[0]
        if sslmode in ("require", "verify-ca", "verify-full"):
            # asyncpg uses 'ssl' instead of 'sslmode'
            connect_args["ssl"] = True
            
    new_query = urllib.parse.urlencode(query_params, doseq=True)
    clean_url = urllib.parse.urlunparse(parsed._replace(query=new_query))
    
    return create_async_engine(
        clean_url,
        connect_args=connect_args,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        echo=False,
    )

engine = _get_engine()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attribute values accessible after commit
)


class Base(DeclarativeBase):
    pass
