from fastapi import APIRouter, HTTPException

from app.storage import get_user_summary

router = APIRouter()


@router.get(
    "/summary/{user_id}",
    summary="Get user transaction summary",
    description="""
Returns a financial summary and full transaction history for the given user.

Transactions are returned in reverse-chronological order (newest first).
Returns **404** if the user has no recorded transactions.
""",
)
async def get_summary(user_id: str) -> dict:
    summary = await get_user_summary(user_id)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"No transactions found for user '{user_id}'.",
        )
    return summary
