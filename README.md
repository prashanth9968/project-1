# 🚀 TransactRank

A production-style financial transaction service built with **FastAPI**, **PostgreSQL**, **SQLAlchemy Async**, and **React (Vite)**. The application demonstrates backend engineering fundamentals including **idempotent transaction processing**, **request validation**, **concurrency-safe balance updates**, **rate limiting**, and a **multi-factor ranking system**.

---

# 🌐 Live Demo

## Frontend

https://guileless-dragon-9c696e.netlify.app/

## Backend API

https://project-1-1-uez3.onrender.com

## Swagger Documentation

https://project-1-1-uez3.onrender.com/docs

## GitHub Repository

https://github.com/prashanth9968/project-1

---

# ✨ Features

* RESTful API built with FastAPI
* PostgreSQL database with SQLAlchemy Async
* Idempotent transaction processing
* Concurrent-safe balance updates
* Duplicate transaction prevention
* Request validation using Pydantic v2
* User financial summary
* Multi-factor ranking algorithm
* Rate limiting
* Interactive Swagger documentation
* React + Vite frontend dashboard
* Dockerized deployment
* Render + Netlify deployment

---

# 🛠 Tech Stack

## Backend

* Python 3.11
* FastAPI
* SQLAlchemy Async
* PostgreSQL
* Pydantic v2
* Uvicorn

## Frontend

* React
* Vite
* JavaScript
* CSS

## Deployment

* Render
* Netlify
* Docker

---

# 📂 Project Structure

```
project-1/
│
├── app/
│   ├── database.py
│   ├── db_models.py
│   ├── storage.py
│   ├── models.py
│   ├── main.py
│   └── routers/
│       ├── transaction.py
│       ├── summary.py
│       └── ranking.py
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
├── Dockerfile
├── requirements.txt
├── render.yaml
└── README.md
```

---

# 🏗 Architecture

```
React (Netlify)
        │
        ▼
FastAPI (Render)
        │
        ▼
PostgreSQL Database
```

---

# ⚙ Running Locally

## Clone Repository

```bash
git clone https://github.com/prashanth9968/project-1.git

cd project-1
```

## Create Virtual Environment

```bash
python -m venv .venv
```

### Windows

```bash
.venv\Scripts\activate
```

### Linux / macOS

```bash
source .venv/bin/activate
```

Install dependencies

```bash
pip install -r requirements.txt
```

Run the server

```bash
uvicorn app.main:app --reload
```

Swagger

```
http://localhost:8000/docs
```

---

# 🚀 Deployment

## Backend

* Render
* Docker
* PostgreSQL

## Frontend

* Netlify
* React + Vite

---

# 📌 API Endpoints

## POST /transaction

Creates a credit or debit transaction.

Example Request

```json
{
  "transaction_id":"txn001",
  "user_id":"alice",
  "amount":500,
  "transaction_type":"credit",
  "category":"salary"
}
```

Returns

* Updated balance
* Transaction status
* Timestamp
* Duplicate flag

---

## GET /summary/{userId}

Returns

* Net Balance
* Total Credits
* Total Debits
* Successful Transactions
* Failed Transactions
* Transaction History

Example

```
GET /summary/alice
```

---

## GET /ranking

Returns the leaderboard of all users ranked using a multi-factor scoring algorithm.

---

# 🏆 Ranking Algorithm

Each user receives a score out of **100**.

### Balance Score (40 Points)

Rewards users with a higher net balance.

```
(max(balance,0)/highest_balance) × 40
```

---

### Activity Score (30 Points)

Rewards engagement.

Maximum considered transactions:

```
50
```

Formula

```
min(successful_transactions,50)/50 × 30
```

---

### Recency Score (30 Points)

| Last Activity | Points |
| ------------- | -----: |
| < 24 Hours    |     30 |
| < 7 Days      |     20 |
| < 30 Days     |     10 |
| ≥ 30 Days     |      0 |

---

### Tie Breaker

Higher Net Balance wins.

---

# 🔒 Duplicate Request Prevention

Each transaction contains a unique

```
transaction_id
```

The backend checks whether the ID already exists.

If yes:

* Transaction is NOT processed again.
* Original response is returned.
* Balance remains unchanged.

This guarantees **idempotency**.

---

# 🔄 Concurrency & Data Consistency

To prevent race conditions:

* Database transactions are used.
* User balance updates are performed atomically.
* Concurrent requests cannot corrupt balances.
* Duplicate requests are safely handled.

---

# 🚦 Rate Limiting

* 10 Transactions
* Per User
* Every 60 Seconds

Exceeding the limit returns

```
HTTP 429
```

---

# 🗄 Database

## Users

| Column     | Description     |
| ---------- | --------------- |
| user_id    | Primary Key     |
| balance    | Current Balance |
| created_at | Timestamp       |

---

## Transactions

| Column           | Description               |
| ---------------- | ------------------------- |
| transaction_id   | Primary Key               |
| user_id          | Foreign Key               |
| amount           | Transaction Amount        |
| transaction_type | Credit / Debit            |
| category         | Category                  |
| status           | Success / Failed          |
| balance_after    | Balance after transaction |
| failure_reason   | Failure reason            |
| created_at       | Timestamp                 |

---

# ✅ Validation

The application validates:

* Transaction ID
* User ID
* Amount
* Transaction Type
* Category

Invalid requests return

```
HTTP 422
```

---

# 🧪 Testing

Swagger

```
https://project-1-1-uez3.onrender.com/docs
```

Test using

* Swagger UI
* Postman
* curl

---

# 🔮 Future Improvements

* JWT Authentication
* Redis Cache
* Distributed Locking
* Kafka Event Streaming
* Audit Logs
* Pagination
* Admin Dashboard
* Docker Compose
* Kubernetes Deployment

---

# 👨‍💻 Author

**Prashanth Goud**

GitHub

https://github.com/prashanth9968/project-1

---

# 📄 License

This project was developed as part of a backend engineering assignment to demonstrate API design, validation, concurrency handling, PostgreSQL integration, deployment, and frontend-backend integration.
