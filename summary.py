from fastapi import APIRouter, HTTPException

from app.storage import get_user_summary

router = APIRouter()


@router.get("/summary/{user_id}")
async def get_summary(user_id: str) -> dict:
    summary = await get_user_summary(user_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"No transactions found for user '{user_id}'.")
    return summary
