from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from app.models import TransactionRequest, TransactionResponse
from app.storage import RateLimitExceeded, storage

router = APIRouter()


@router.post(
    "/transaction",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a transaction",
    description="""
Submit a credit or debit transaction for a user.

**Idempotency**: the `transaction_id` field acts as an idempotency key.
Re-submitting the same ID returns the original result with `is_duplicate: true`
and never double-applies the transaction.

**Rate limiting**: each user may submit at most 10 transactions per 60-second
rolling window. HTTP 429 is returned when the limit is exceeded.

**Debit validation**: a debit that exceeds the user's current net balance is
recorded as `status: failed` (with `failure_reason: insufficient_balance`)
rather than rejected outright, so the idempotency record is still created.
""",
)
async def post_transaction(body: TransactionRequest) -> TransactionResponse:
    txn_data: dict = {
        "transaction_id": body.transaction_id,
        "user_id": body.user_id,
        "amount": body.amount,
        "transaction_type": body.transaction_type.value,
        "category": body.category.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        # These fields are filled in by storage.add_transaction:
        "status": "pending",
        "failure_reason": None,
        "balance_after": 0.0,
    }

    try:
        result = await storage.add_transaction(txn_data)
    except RateLimitExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    txn = result["transaction"]
    is_dup = result["duplicate"]

    if is_dup:
        msg = "Duplicate transaction_id — returning original result."
    elif txn["status"] == "success":
        msg = "Transaction processed successfully."
    else:
        msg = f"Transaction failed: {txn.get('failure_reason', 'unknown')}."

    return TransactionResponse(
        transaction_id=txn["transaction_id"],
        user_id=txn["user_id"],
        amount=txn["amount"],
        transaction_type=txn["transaction_type"],
        category=txn["category"],
        timestamp=txn["timestamp"],
        status=txn["status"],
        balance_after=txn["balance_after"],
        failure_reason=txn.get("failure_reason"),
        is_duplicate=is_dup,
        message=msg,
    )
