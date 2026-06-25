"""
In-memory storage layer for TransactRank.

All mutations are serialised through a single asyncio.Lock, which guarantees:
  - Duplicate-check and balance-update happen atomically (no TOCTOU race).
  - Two simultaneous debits against the same balance cannot both pass the check.
  - A transaction_id is never processed more than once, even under concurrent load.

Limitation: the Lock works within a single process.  For multi-worker deployments
replace with a Redis-based store and use Redlock for distributed locking.
"""

import asyncio
import time
from collections import defaultdict
from typing import Dict, List, Optional


class RateLimitExceeded(Exception):
    """Raised when a user exceeds the per-minute transaction limit."""


class InMemoryStorage:
    # ------------------------------------------------------------------ config
    RATE_WINDOW_SEC: int = 60   # rolling window length
    RATE_LIMIT: int = 10        # max transactions per window per user

    def __init__(self) -> None:
        self._lock = asyncio.Lock()

        # Primary data
        self._transactions: Dict[str, dict] = {}
        self._user_txns: Dict[str, List[str]] = defaultdict(list)
        self._balances: Dict[str, float] = defaultdict(float)

        # Idempotency: O(1) lookup for seen transaction IDs
        self._processed_ids: set[str] = set()

        # Rate limiting: user_id → list of Unix timestamps (within current window)
        self._rate_windows: Dict[str, List[float]] = defaultdict(list)

    # ---------------------------------------------------------------- writes

    async def add_transaction(self, txn: dict) -> dict:
        """
        Atomically validate and apply one transaction.

        Returns a dict with keys:
            duplicate (bool)  – True when transaction_id was already processed
            transaction (dict) – the stored transaction record

        Raises RateLimitExceeded when the user has hit the rate cap.
        """
        async with self._lock:
            txn_id = txn["transaction_id"]
            user_id = txn["user_id"]

            # ── 1. Idempotency check ───────────────────────────────────────
            if txn_id in self._processed_ids:
                return {"duplicate": True, "transaction": self._transactions[txn_id]}

            # ── 2. Rate-limit check ────────────────────────────────────────
            now = time.monotonic()
            window = self._rate_windows[user_id]
            # Purge expired timestamps
            cutoff = now - self.RATE_WINDOW_SEC
            self._rate_windows[user_id] = [t for t in window if t > cutoff]

            if len(self._rate_windows[user_id]) >= self.RATE_LIMIT:
                raise RateLimitExceeded(
                    f"User '{user_id}' exceeded {self.RATE_LIMIT} transactions "
                    f"per {self.RATE_WINDOW_SEC}s. Please retry later."
                )

            # ── 3. Apply the transaction ───────────────────────────────────
            amount = txn["amount"]
            current_balance = self._balances[user_id]

            if txn["transaction_type"] == "debit":
                if current_balance < amount:
                    txn["status"] = "failed"
                    txn["failure_reason"] = "insufficient_balance"
                    txn["balance_after"] = round(current_balance, 2)
                else:
                    self._balances[user_id] = round(current_balance - amount, 2)
                    txn["status"] = "success"
                    txn["failure_reason"] = None
                    txn["balance_after"] = self._balances[user_id]
            else:  # credit
                self._balances[user_id] = round(current_balance + amount, 2)
                txn["status"] = "success"
                txn["failure_reason"] = None
                txn["balance_after"] = self._balances[user_id]

            # ── 4. Persist ─────────────────────────────────────────────────
            self._transactions[txn_id] = txn
            self._user_txns[user_id].append(txn_id)
            self._processed_ids.add(txn_id)
            self._rate_windows[user_id].append(now)

            return {"duplicate": False, "transaction": txn}

    # ----------------------------------------------------------------- reads
    # Reads are snapshot reads without the lock – acceptable for eventual-
    # consistent views like summaries and leaderboards.

    async def get_user_summary(self, user_id: str) -> Optional[dict]:
        """Return aggregated summary for one user, or None if unknown."""
        txn_ids = self._user_txns.get(user_id)
        if not txn_ids:
            return None

        txns = [self._transactions[tid] for tid in txn_ids]
        success = [t for t in txns if t["status"] == "success"]

        total_credits = sum(
            t["amount"] for t in success if t["transaction_type"] == "credit"
        )
        total_debits = sum(
            t["amount"] for t in success if t["transaction_type"] == "debit"
        )

        return {
            "user_id": user_id,
            "net_balance": round(self._balances[user_id], 2),
            "total_credits": round(total_credits, 2),
            "total_debits": round(total_debits, 2),
            "transaction_count": len(txns),
            "successful_transactions": len(success),
            "failed_transactions": len(txns) - len(success),
            "transactions": sorted(txns, key=lambda t: t["timestamp"], reverse=True),
        }

    async def get_all_user_stats(self) -> List[dict]:
        """Return per-user aggregates for ranking (excludes users with no data)."""
        result = []
        for user_id, txn_ids in self._user_txns.items():
            txns = [self._transactions[tid] for tid in txn_ids]
            success = [t for t in txns if t["status"] == "success"]
            if not success:
                continue

            credits = sum(t["amount"] for t in success if t["transaction_type"] == "credit")
            debits = sum(t["amount"] for t in success if t["transaction_type"] == "debit")
            timestamps = [t["timestamp"] for t in txns]

            result.append(
                {
                    "user_id": user_id,
                    "net_balance": round(self._balances[user_id], 2),
                    "total_credits": round(credits, 2),
                    "total_debits": round(debits, 2),
                    "transaction_count": len(txns),
                    "successful_count": len(success),
                    "first_transaction": min(timestamps),
                    "last_transaction": max(timestamps),
                }
            )
        return result


# Module-level singleton – imported by all routers
storage = InMemoryStorage()
