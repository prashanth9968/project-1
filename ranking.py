from fastapi import APIRouter

from app.ranking import compute_rankings
from app.storage import get_all_user_stats

router = APIRouter()

_EXPLANATION = (
    "Score (0–100) = Balance Score (0–40) + Activity Score (0–30) + Recency Score (0–30). "
    "Balance: normalised net balance vs. global max. "
    "Activity: successful tx count capped at 50 (anti-spam). "
    "Recency: 30 pts if active within 24 h, 20 pts within 7 d, 10 pts within 30 d."
)


@router.get("/ranking")
async def get_ranking() -> dict:
    all_stats = await get_all_user_stats()
    rankings  = compute_rankings(all_stats)
    return {
        "total_users": len(rankings),
        "rankings":    rankings,
        "ranking_explanation": _EXPLANATION,
    }
