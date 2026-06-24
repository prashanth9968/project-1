FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

EXPOSE 8000

# Use a single worker for in-memory storage consistency.
# Switch to --workers 4 only after migrating to a shared external store (Redis/Postgres).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
