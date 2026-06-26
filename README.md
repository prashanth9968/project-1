# TransactRank

TransactRank is a financial transaction service built with **FastAPI**, **PostgreSQL**, **SQLAlchemy Async**, and **React (Vite)**. It demonstrates backend fundamentals including request validation, idempotent transaction processing, concurrent-safe balance updates, rate limiting, and a multi-factor user ranking system.

## Live Demo

**Frontend:**
https://guileless-dragon-9c696e.netlify.app/

**Backend API:**
https://project-1-1-uez3.onrender.com

**Swagger Documentation:**
https://project-1-1-uez3.onrender.com/docs

**GitHub Repository:**
https://github.com/prashanth9968/project-1

---

# How to Run the Project

## Backend

Clone the repository:

```bash
git clone https://github.com/prashanth9968/project-1.git
cd project-1
```

Create and activate a virtual environment:

```bash
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run the server:

```bash
uvicorn app.main:app --reload
```

Swagger UI:

```
http://localhost:8000/docs
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

---

# API Overview

## POST `/transaction`

Creates a new financial transaction.

### Request

```json
{
  "transaction_id": "txn001",
  "user_id": "alice",
  "amount": 500,
  "transaction_type": "credit",
  "category": "salary"
}
```

### Functionality

* Validates request data
* Prevents duplicate transactions using `transaction_id`
* Updates user balance safely
* Stores the transaction
* Returns the updated balance and transaction status

---

## GET `/summary/{userId}`

Returns:

* Current balance
* Total credits
* Total debits
* Successful transactions
* Failed transactions
* Complete transaction history

Example:

```
GET /summary/alice
```

---

## GET `/ranking`

Returns the global leaderboard of users ranked using a composite score.

Each ranking includes:

* User ID
* Rank
* Total Score
* Net Balance
* Transaction Statistics

---

# Ranking Algorithm

Each user receives a score out of **100**.

### Balance Score (40%)

Higher balances receive more points.

### Activity Score (30%)

Based on successful transactions.

The activity score is capped at **50 successful transactions** to prevent users from increasing their score through excessive small transactions.

### Recency Score (30%)

Rewards recently active users.

| Last Activity | Score |
| ------------- | ----: |
| < 24 Hours    |    30 |
| < 7 Days      |    20 |
| < 30 Days     |    10 |
| ≥ 30 Days     |     0 |

If two users have the same score, the user with the higher net balance ranks first.

---

# Duplicate Request Prevention

The application uses **idempotency** through the `transaction_id`.

For every incoming transaction:

1. The server checks whether the `transaction_id` already exists.
2. If it is new, the transaction is processed and stored.
3. If the same `transaction_id` is submitted again, the original response is returned.
4. The balance is **not updated again**, preventing duplicate processing.

This guarantees that retries caused by network failures cannot create duplicate transactions.

---

# Tech Stack

**Backend**

* Python
* FastAPI
* PostgreSQL
* SQLAlchemy Async
* Pydantic

**Frontend**

* React
* Vite

**Deployment**

* Render
* Netlify

---

# Assignment Requirements Covered

* ✅ Request validation
* ✅ Safe concurrent updates
* ✅ Duplicate request prevention
* ✅ Data consistency
* ✅ Multi-factor ranking algorithm
* ✅ Rate limiting
* ✅ Live frontend
* ✅ Live backend
* ✅ PostgreSQL persistence
