from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from app.models import TransactionRequest, TransactionResponse
from app.storage import RateLimitExceeded, add_transaction

router = APIRouter()


@router.post("/transaction", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def post_transaction(body: TransactionRequest) -> TransactionResponse:
    txn_data = {
        "transaction_id":   body.transaction_id,
        "user_id":          body.user_id,
        "amount":           body.amount,
        "transaction_type": body.transaction_type.value,
        "category":         body.category.value,
    }

    try:
        result = await add_transaction(txn_data)
    except RateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    txn    = result["transaction"]
    is_dup = result["duplicate"]

    if is_dup:
        msg = "Duplicate transaction_id — returning original result."
    elif txn["status"] == "success":
        msg = "Transaction processed successfully."
    else:
        msg = f"Transaction failed: {txn.get('failure_reason', 'unknown')}."

    return TransactionResponse(
        transaction_id   = txn["transaction_id"],
        user_id          = txn["user_id"],
        amount           = txn["amount"],
        transaction_type = txn["transaction_type"],
        category         = txn["category"],
        timestamp        = txn["timestamp"] or datetime.now(timezone.utc).isoformat(),
        status           = txn["status"],
        balance_after    = txn["balance_after"],
        failure_reason   = txn.get("failure_reason"),
        is_duplicate     = is_dup,
        message          = msg,
    )
