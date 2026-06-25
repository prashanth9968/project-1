"""
PostgreSQL-backed storage layer.

Concurrency model
─────────────────
Every write does:
  1. INSERT INTO users … ON CONFLICT DO NOTHING   ← ensure the row exists
  2. SELECT … FOR UPDATE                           ← lock the row
  3. Read/write balance, insert transaction        ← inside the same transaction

The database holds the lock — not asyncio — so this is safe across any
number of Uvicorn workers or Railway instances.

Rate-limit counting is also done inside the locked transaction:

  SELECT COUNT(*) FROM transactions
  WHERE user_id = ? AND created_at >= now() - interval '60 seconds'

so a user can never slip past the limit by firing concurrent requests.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import AsyncSessionLocal
from app.db_models import Transaction, User

_RATE_LIMIT_MAX    = 10
_RATE_LIMIT_WINDOW = 60  # seconds


class RateLimitExceeded(Exception):
    pass


# ─────────────────────────────────────────────── write ───────────────────────

async def add_transaction(txn: dict) -> dict:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            txn_id  = txn["transaction_id"]
            user_id = txn["user_id"]
            amount  = float(txn["amount"])

            # 1. Idempotency check — primary-key lookup, O(1)
            existing = await session.get(Transaction, txn_id)
            if existing:
                return {"duplicate": True, "transaction": _to_dict(existing)}

            # 2. Ensure the user row exists, then lock it
            await session.execute(
                pg_insert(User)
                .values(user_id=user_id, balance=0)
                .on_conflict_do_nothing(index_elements=["user_id"])
            )
            user_row = (
                await session.execute(
                    select(User).where(User.user_id == user_id).with_for_update()
                )
            ).scalar_one()

            # 3. Rate limit — counted at DB level, works across all instances
            window_start = datetime.now(timezone.utc) - timedelta(seconds=_RATE_LIMIT_WINDOW)
            count = (
                await session.execute(
                    select(func.count())
                    .select_from(Transaction)
                    .where(Transaction.user_id == user_id)
                    .where(Transaction.created_at >= window_start)
                )
            ).scalar()
            if count >= _RATE_LIMIT_MAX:
                raise RateLimitExceeded(
                    f"User '{user_id}' exceeded {_RATE_LIMIT_MAX} transactions "
                    f"per {_RATE_LIMIT_WINDOW} s."
                )

            # 4. Apply balance change
            current = float(user_row.balance)
            if txn["transaction_type"] == "debit":
                if current < amount:
                    status, reason, balance_after = "failed", "insufficient_balance", current
                else:
                    balance_after = round(current - amount, 2)
                    user_row.balance = balance_after
                    status, reason = "success", None
            else:
                balance_after = round(current + amount, 2)
                user_row.balance = balance_after
                status, reason = "success", None

            # 5. Write the transaction record
            ts = datetime.now(timezone.utc)
            record = Transaction(
                transaction_id   = txn_id,
                user_id          = user_id,
                amount           = amount,
                transaction_type = txn["transaction_type"],
                category         = txn.get("category", "other"),
                status           = status,
                failure_reason   = reason,
                balance_after    = balance_after,
                created_at       = ts,
            )
            session.add(record)

        return {"duplicate": False, "transaction": _to_dict(record)}


# ─────────────────────────────────────────────── reads ───────────────────────

async def get_user_summary(user_id: str) -> Optional[dict]:
    async with AsyncSessionLocal() as session:
        txns = (
            await session.execute(
                select(Transaction)
                .where(Transaction.user_id == user_id)
                .order_by(Transaction.created_at.desc())
            )
        ).scalars().all()

        if not txns:
            return None

        user = await session.get(User, user_id)
        ok   = [t for t in txns if t.status == "success"]

        return {
            "user_id":                 user_id,
            "net_balance":             float(user.balance),
            "total_credits":           round(sum(float(t.amount) for t in ok if t.transaction_type == "credit"), 2),
            "total_debits":            round(sum(float(t.amount) for t in ok if t.transaction_type == "debit"),  2),
            "transaction_count":       len(txns),
            "successful_transactions": len(ok),
            "failed_transactions":     len(txns) - len(ok),
            "transactions":            [_to_dict(t) for t in txns],
        }


async def get_all_user_stats() -> list[dict]:
    """Two queries total (transactions + users) regardless of user count."""
    async with AsyncSessionLocal() as session:
        all_txns     = (await session.execute(select(Transaction))).scalars().all()
        balances     = {
            u.user_id: float(u.balance)
            for u in (await session.execute(select(User))).scalars().all()
        }

    by_user: dict[str, list] = defaultdict(list)
    for t in all_txns:
        by_user[t.user_id].append(t)

    rows = []
    for uid, txns in by_user.items():
        ok = [t for t in txns if t.status == "success"]
        if not ok:
            continue
        rows.append({
            "user_id":          uid,
            "net_balance":      balances.get(uid, 0.0),
            "total_credits":    round(sum(float(t.amount) for t in ok if t.transaction_type == "credit"), 2),
            "total_debits":     round(sum(float(t.amount) for t in ok if t.transaction_type == "debit"),  2),
            "transaction_count": len(txns),
            "successful_count": len(ok),
            "first_transaction": min(t.created_at for t in txns).isoformat(),
            "last_transaction":  max(t.created_at for t in txns).isoformat(),
        })
    return rows


# ─────────────────────────────────────────────── helper ──────────────────────

def _to_dict(t: Transaction) -> dict:
    return {
        "transaction_id":   t.transaction_id,
        "user_id":          t.user_id,
        "amount":           float(t.amount),
        "transaction_type": t.transaction_type,
        "category":         t.category,
        "timestamp":        t.created_at.isoformat() if t.created_at else None,
        "status":           t.status,
        "failure_reason":   t.failure_reason,
        "balance_after":    float(t.balance_after),
    }
