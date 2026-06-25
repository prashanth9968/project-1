"""
Multi-factor ranking algorithm for TransactRank.

Score (max 100) = Balance Score + Activity Score + Recency Score

──────────────────────────────────────────────────────────────────────────
Factor          Weight    Formula
──────────────────────────────────────────────────────────────────────────
Balance Score    0–40    (max(net_balance, 0) / global_max_balance) × 40
                         Rewards real financial growth.
                         Negative balances score 0 (not penalised further).

Activity Score   0–30    min(successful_tx_count, 50) / 50 × 30
                         Rewards engagement but CAPS at 50 transactions so
                         that spamming micro-transactions can't inflate rank.

Recency Score    0–30    30 if last tx < 24 h ago
                         20 if last tx < 7 days ago
                         10 if last tx < 30 days ago
                          0 otherwise
                         Rewards sustained, ongoing use over one-time bursts.
──────────────────────────────────────────────────────────────────────────

Tiebreaker: higher net balance wins when two users share the same score.
"""

from datetime import datetime, timezone
from typing import List

# Activity score cap: transactions beyond this count the same as exactly this many
_ACTIVITY_CAP = 50


def _parse_ts(ts) -> datetime:
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(str(ts))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _recency_score(last_transaction_ts) -> float:
    hours = (datetime.now(timezone.utc) - _parse_ts(last_transaction_ts)).total_seconds() / 3600
    if hours <= 24:
        return 30.0
    if hours <= 168:   # 7 days
        return 20.0
    if hours <= 720:   # 30 days
        return 10.0
    return 0.0


def _balance_score(net_balance: float, max_balance: float) -> float:
    if max_balance <= 0:
        return 0.0
    return (max(net_balance, 0) / max_balance) * 40


def _activity_score(successful_count: int) -> float:
    return (min(successful_count, _ACTIVITY_CAP) / _ACTIVITY_CAP) * 30


def compute_rankings(all_user_stats: List[dict]) -> List[dict]:
    """
    Given a list of per-user stat dicts (from storage.get_all_user_stats),
    return a ranked list enriched with scores and breakdowns.
    """
    if not all_user_stats:
        return []

    # Normalise balance against the global maximum
    max_balance = max((max(u["net_balance"], 0) for u in all_user_stats), default=1)
    if max_balance == 0:
        max_balance = 1  # avoid division by zero when all balances are ≤ 0

    scored: List[dict] = []
    for u in all_user_stats:
        bs = round(_balance_score(u["net_balance"], max_balance), 2)
        as_ = round(_activity_score(u["successful_count"]), 2)
        rs = round(_recency_score(u["last_transaction"]), 2)
        total = round(bs + as_ + rs, 2)

        scored.append(
            {
                "user_id": u["user_id"],
                "score": total,
                "net_balance": u["net_balance"],
                "total_credits": u["total_credits"],
                "total_debits": u["total_debits"],
                "transaction_count": u["transaction_count"],
                "successful_transactions": u["successful_count"],
                "last_active": u["last_transaction"],
                "score_breakdown": {
                    "balance_score": bs,
                    "activity_score": as_,
                    "recency_score": rs,
                },
            }
        )

    # Primary sort: score desc; tiebreaker: net_balance desc
    scored.sort(key=lambda x: (x["score"], x["net_balance"]), reverse=True)

    # Assign ranks (shared rank for tied scores)
    rank = 1
    for i, entry in enumerate(scored):
        if i > 0 and scored[i]["score"] == scored[i - 1]["score"]:
            entry["rank"] = scored[i - 1]["rank"]
        else:
            entry["rank"] = rank
        rank += 1

    return scored
from fastapi import APIRouter

router = APIRouter()

@router.get("/ranking", summary="Get global user rankings")
async def global_ranking():
    from app.storage import storage
    stats = await storage.get_all_user_stats()
    # Change get_global_ranking to compute_rankings here:
    return compute_rankings(stats)