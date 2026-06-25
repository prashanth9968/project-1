"""
Data models for TransactRank.
All request validation lives here; FastAPI returns 422 on constraint violations.
"""

import re
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class TransactionType(str, Enum):
    CREDIT = "credit"
    DEBIT = "debit"


class Category(str, Enum):
    FOOD = "food"
    TRANSPORT = "transport"
    ENTERTAINMENT = "entertainment"
    UTILITIES = "utilities"
    SHOPPING = "shopping"
    SALARY = "salary"
    OTHER = "other"


_SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")


class TransactionRequest(BaseModel):
    """
    Client-supplied fields for a new transaction.

    transaction_id acts as an idempotency key: submitting the same ID twice
    returns the original result without re-applying the transaction.
    """

    transaction_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Unique idempotency key (alphanumeric + _ -)",
        examples=["txn_abc123"],
    )
    user_id: str = Field(
        ...,
        min_length=3,
        max_length=50,
        description="User identifier (alphanumeric + _ -)",
        examples=["alice"],
    )
    amount: float = Field(
        ...,
        gt=0,
        description="Positive transaction amount in USD (0.01 – 100 000)",
        examples=[250.00],
    )
    transaction_type: TransactionType = Field(
        ..., description="'credit' adds funds; 'debit' withdraws funds"
    )
    category: Category = Field(Category.OTHER, description="Optional spending category")

    @field_validator("transaction_id", "user_id")
    @classmethod
    def _safe_chars(cls, v: str) -> str:
        if not _SAFE_ID.match(v):
            raise ValueError("Only letters, digits, hyphens, and underscores are allowed")
        return v

    @field_validator("amount")
    @classmethod
    def _amount_bounds(cls, v: float) -> float:
        if v < 0.01:
            raise ValueError("amount must be at least 0.01")
        if v > 100_000:
            raise ValueError("amount must not exceed 100,000")
        return round(v, 2)

    model_config = {
        "json_schema_extra": {
            "example": {
                "transaction_id": "txn_abc123",
                "user_id": "alice",
                "amount": 250.00,
                "transaction_type": "credit",
                "category": "salary",
            }
        }
    }


class TransactionResponse(BaseModel):
    transaction_id: str
    user_id: str
    amount: float
    transaction_type: str
    category: str
    timestamp: str
    status: str
    balance_after: float
    failure_reason: Optional[str]
    is_duplicate: bool
    message: str


class ScoreBreakdown(BaseModel):
    balance_score: float = Field(description="0–40: net-balance vs. global max")
    activity_score: float = Field(description="0–30: successful tx count, capped at 50")
    recency_score: float = Field(description="0–30: time since last transaction")


class RankEntry(BaseModel):
    rank: int
    user_id: str
    score: float
    net_balance: float
    total_credits: float
    total_debits: float
    transaction_count: int
    successful_transactions: int
    last_active: str
    score_breakdown: ScoreBreakdown


class RankingResponse(BaseModel):
    total_users: int
    rankings: list[RankEntry]
    ranking_explanation: str
