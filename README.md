# TransactRank

A Python financial-transaction service with idempotent writes, concurrent-safe
balance updates, rate-limited users, and a multi-factor leaderboard.

Built with **FastAPI + Pydantic v2**.  Storage is in-memory (no database
required), with an `asyncio.Lock` guarding all mutations.

---

## Table of Contents

1. [Running the project](#running-the-project)
2. [API reference](#api-reference)
3. [Ranking algorithm](#ranking-algorithm)
4. [Duplicate prevention](#duplicate-prevention)
5. [Concurrency & data consistency](#concurrency--data-consistency)
6. [Rate limiting](#rate-limiting)
7. [Data schema](#data-schema)
8. [Assumptions & limitations](#assumptions--limitations)
9. [Testing with curl](#testing-with-curl)

---

## Running the project

### Prerequisites
- Python 3.11+  **or** Docker

### Local (virtualenv)

```bash
git clone <repo>
cd transact-rank

python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

pip install -r requirements.txt

# Start the server (auto-reload for development)
uvicorn app.main:app --reload
```

Browse to:
- **Swagger UI** → http://localhost:8000/docs
- **ReDoc**       → http://localhost:8000/redoc

### Docker

```bash
docker build -t transact-rank .
docker run -p 8000:8000 transact-rank
```

### Deploy to Railway

```bash
# Install Railway CLI: https://docs.railway.app/develop/cli
railway login
railway init
railway up
```

Railway auto-detects the `Dockerfile`; no extra config needed.

### Deploy to Render

Create a new **Web Service**, point it at your repo, and set:

| Field | Value |
|-------|-------|
| Environment | Docker |
| Port | 8000 |
| Start command | (leave blank – Dockerfile CMD is used) |

---

## API reference

### `POST /transaction`

Submit a credit or debit transaction.

**Request body**

```json
{
  "transaction_id": "txn_abc123",
  "user_id":        "alice",
  "amount":         250.00,
  "transaction_type": "credit",
  "category":       "salary"
}
```

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `transaction_id` | string | ✓ | 1–64 chars, `[a-zA-Z0-9_-]` |
| `user_id` | string | ✓ | 3–50 chars, `[a-zA-Z0-9_-]` |
| `amount` | float | ✓ | 0.01 – 100 000 |
| `transaction_type` | `"credit"` \| `"debit"` | ✓ | |
| `category` | string | – | food / transport / entertainment / utilities / shopping / salary / other |

**Response `201 Created`**

```json
{
  "transaction_id":   "txn_abc123",
  "user_id":          "alice",
  "amount":           250.00,
  "transaction_type": "credit",
  "category":         "salary",
  "timestamp":        "2025-01-15T10:30:00+00:00",
  "status":           "success",
  "balance_after":    250.00,
  "failure_reason":   null,
  "is_duplicate":     false,
  "message":          "Transaction processed successfully."
}
```

**Error responses**

| Code | Reason |
|------|--------|
| 422  | Validation error (missing field, bad format, amount out of range) |
| 429  | Rate limit exceeded (10 tx / 60 s per user) |

**Debit failure**: if a debit exceeds the user's current balance, the transaction
is recorded with `status: "failed"` and `failure_reason: "insufficient_balance"`.
The response is still `201` because the request itself was valid; the idempotency
record is created so a retry returns the same result.

---

### `GET /summary/{user_id}`

Return the financial summary and full transaction history for one user.

**Response `200 OK`**

```json
{
  "user_id":                "alice",
  "net_balance":            1900.00,
  "total_credits":          2500.00,
  "total_debits":           600.00,
  "transaction_count":      5,
  "successful_transactions": 4,
  "failed_transactions":    1,
  "transactions": [
    {
      "transaction_id":   "txn_abc123",
      "user_id":          "alice",
      "amount":           250.00,
      "transaction_type": "credit",
      "category":         "salary",
      "timestamp":        "2025-01-15T10:30:00+00:00",
      "status":           "success",
      "balance_after":    250.00,
      "failure_reason":   null
    }
  ]
}
```

**Error**: `404` if the user has no transactions.

---

### `GET /ranking`

Return the global leaderboard, sorted by composite score descending.

**Response `200 OK`**

```json
{
  "total_users": 3,
  "ranking_explanation": "Score (0–100) = Balance (0–40) + Activity (0–30) + Recency (0–30) …",
  "rankings": [
    {
      "rank":                   1,
      "user_id":                "diana",
      "score":                  82.4,
      "net_balance":            8200.00,
      "total_credits":          8700.00,
      "total_debits":           500.00,
      "transaction_count":      4,
      "successful_transactions": 4,
      "last_active":            "2025-01-15T10:00:00+00:00",
      "score_breakdown": {
        "balance_score":   40.0,
        "activity_score":  2.4,
        "recency_score":   30.0
      }
    }
  ]
}
```

---

## Ranking algorithm

```
Score (max 100) = Balance Score + Activity Score + Recency Score
```

### Balance Score — 0 to 40 points

Rewards genuine financial growth.

```
balance_score = (max(net_balance, 0) / global_max_balance) × 40
```

- Negative balances score 0 (not penalised further).
- `global_max_balance` is the highest net balance across all users in the
  current dataset; scores update as balances change.

### Activity Score — 0 to 30 points

Rewards engagement while **hard-capping at 50 successful transactions** to
prevent gamers from flooding micro-transactions to inflate rank.

```
activity_score = min(successful_tx_count, 50) / 50 × 30
```

### Recency Score — 0 to 30 points

Rewards sustained, ongoing engagement rather than one-time activity bursts.

| Time since last transaction | Points |
|-----------------------------|--------|
| < 24 hours                  | 30     |
| < 7 days                    | 20     |
| < 30 days                   | 10     |
| ≥ 30 days                   | 0      |

### Tiebreaker

Users with identical scores are ranked by `net_balance` descending.

### Why this combination?

- **Balance alone** rewards the person who deposited the most – easy to game
  with a single large credit.
- **Activity alone** rewards spam.
- **Recency alone** rewards a single recent transaction.

Combining all three means a top-ranked user must have a healthy balance,
meaningful transaction history, *and* recent activity.

---

## Duplicate prevention

1. The client generates a unique `transaction_id` (recommended: UUID v4 or
   `txn_<timestamp>_<random>`).
2. On receipt, the server checks `transaction_id` against a hash-set of
   processed IDs in **O(1)** time — inside the same mutex lock as the balance
   update (no TOCTOU window).
3. If the ID has been seen before, the server returns the original result with
   `is_duplicate: true`.  The transaction is **never applied twice**.
4. Even failed transactions (e.g., insufficient balance) record their ID, so a
   retry of a failed debit cannot succeed on a second attempt either.

---

## Concurrency & data consistency

All mutations (`add_transaction`) acquire a single `asyncio.Lock` for the
entire sequence:

```
[lock acquired]
  1. Duplicate check  (read _processed_ids)
  2. Rate-limit check (read + write _rate_windows)
  3. Balance check    (read _balances)
  4. Apply balance    (write _balances)
  5. Persist record   (write _transactions, _user_txns, _processed_ids)
[lock released]
```

This prevents classic race conditions such as:
- Two simultaneous identical transactions both passing the duplicate check.
- Two concurrent debits both passing the balance check then over-drawing.

**Single-worker note**: the lock works within one OS process.  When running
with multiple Uvicorn workers (`--workers N`), each worker has its own
in-memory state.  For multi-worker production use, replace the in-memory store
with Redis and use Redlock for distributed locking.

---

## Rate limiting

- **Window**: 60 seconds (rolling, per user)
- **Limit**: 10 transactions
- **Scope**: per `user_id`
- **Response**: `HTTP 429` with a human-readable message
- **Implementation**: timestamps stored in a per-user list; expired entries are
  purged on each incoming request (no background thread needed)

---

## Data schema

### Transaction record (stored internally)

| Field | Type | Notes |
|-------|------|-------|
| `transaction_id` | str | Unique idempotency key |
| `user_id` | str | Owner |
| `amount` | float | Rounded to 2 decimal places |
| `transaction_type` | str | `"credit"` or `"debit"` |
| `category` | str | One of the Category enum values |
| `timestamp` | str | ISO 8601 UTC |
| `status` | str | `"success"` or `"failed"` |
| `balance_after` | float | User's net balance after this transaction |
| `failure_reason` | str \| null | Populated when `status = "failed"` |

### Derived user balance

`net_balance = Σ(credit amounts) − Σ(debit amounts)` for **successful** transactions only.

---

## Assumptions & limitations

| Assumption | Implication |
|------------|-------------|
| In-memory storage | Data is lost on restart; use Redis/Postgres for persistence |
| No authentication | `user_id` is trusted as-is; add JWT in production |
| Single Uvicorn worker | Multi-worker needs a shared store and distributed lock |
| USD only | No currency conversion |
| No pagination | `GET /summary` returns all transactions; add cursor pagination at scale |
| Mock data in demo | The React frontend is pre-seeded with 5 users so ranking is visible immediately |

---

## Testing with curl

```bash
BASE=http://localhost:8000

# Submit a credit
curl -s -X POST $BASE/transaction \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_001","user_id":"alice","amount":500,"transaction_type":"credit","category":"salary"}' \
  | python3 -m json.tool

# Submit the same ID again (idempotency check)
curl -s -X POST $BASE/transaction \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_001","user_id":"alice","amount":500,"transaction_type":"credit","category":"salary"}' \
  | python3 -m json.tool

# Attempt an over-draw
curl -s -X POST $BASE/transaction \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_002","user_id":"alice","amount":99999,"transaction_type":"debit"}' \
  | python3 -m json.tool

# Get alice's summary
curl -s $BASE/summary/alice | python3 -m json.tool

# Global ranking
curl -s $BASE/ranking | python3 -m json.tool

# Invalid amount (triggers 422)
curl -s -X POST $BASE/transaction \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_003","user_id":"alice","amount":-5,"transaction_type":"credit"}' \
  | python3 -m json.tool
```
