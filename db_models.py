"""
SQLAlchemy ORM models — these map directly to the Postgres schema.

Schema rationale
────────────────
users.balance is the single source of truth for net balance.  It is
updated atomically inside a SELECT … FOR UPDATE transaction, so it
never drifts from the sum of transactions even under concurrent load.

transactions.transaction_id is the primary key and serves as the
idempotency key: duplicate submissions are detected in O(1) via a
primary-key lookup before any write happens.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Numeric,
    String,
    func,
)

from app.database import Base


class User(Base):
    """
    One row per unique user_id.
    balance is kept denormalised here so ranking queries are O(users)
    instead of O(transactions).
    """

    __tablename__ = "users"

    user_id    = Column(String(50),     primary_key=True)
    balance    = Column(Numeric(15, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Transaction(Base):
    """
    Immutable ledger record.  Failed transactions are persisted so that
    their transaction_id is consumed — retrying a failed debit will not
    silently rerun it.
    """

    __tablename__ = "transactions"

    transaction_id   = Column(String(64),      primary_key=True)
    user_id          = Column(String(50),       nullable=False)
    amount           = Column(Numeric(15, 2),   nullable=False)
    transaction_type = Column(String(10),       nullable=False)
    category         = Column(String(20),       nullable=False, default="other")
    status           = Column(String(10),       nullable=False)
    failure_reason   = Column(String(100),      nullable=True)
    balance_after    = Column(Numeric(15, 2),   nullable=False)
    created_at       = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("transaction_type IN ('credit','debit')", name="ck_txn_type"),
        CheckConstraint("status IN ('success','failed')",         name="ck_txn_status"),
        CheckConstraint("amount > 0",                             name="ck_txn_amount"),
        Index("ix_transactions_user_created", "user_id", "created_at"),
    )
