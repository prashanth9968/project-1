from fastapi import APIRouter

from app.ranking import compute_rankings
from app.storage import storage

router = APIRouter()

_EXPLANATION = (
    "Score (0–100) = Balance Score (0–40) + Activity Score (0–30) + Recency Score (0–30). "
    "Balance: normalised net balance vs. the global maximum. "
    "Activity: successful transaction count capped at 50 (anti-spam). "
    "Recency: 30 pts if active within 24 h, 20 pts within 7 d, 10 pts within 30 d."
)


@router.get(
    "/ranking",
    summary="Global leaderboard",
    description="""
Returns all users sorted by composite score (highest first).

The three-factor score (see `ranking_explanation`) balances financial health,
engagement frequency, and recency.  Capping the activity factor at 50
transactions prevents users from gaming the board with micro-transactions.

Users with the same score share a rank; the tiebreaker is net balance.
""",
)
async def get_ranking() -> dict:
    all_stats = await storage.get_all_user_stats()
    rankings = compute_rankings(all_stats)

    return {
        "total_users": len(rankings),
        "rankings": rankings,
        "ranking_explanation": _EXPLANATION,
    }
