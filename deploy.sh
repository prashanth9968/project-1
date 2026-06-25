#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  TransactRank — one-shot Railway deployment
#  Run this from the transact-rank/ project root.
# ─────────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}=== TransactRank — Railway Deploy ===${NC}\n"

# 1. Railway CLI
if ! command -v railway &> /dev/null; then
  echo "Installing Railway CLI..."
  curl -fsSL https://railway.app/install.sh | sh
  export PATH="$HOME/.railway/bin:$PATH"
fi

# 2. Login (opens browser once, token cached forever after)
echo -e "${YELLOW}Step 1/4${NC} — Railway login"
railway login

# 3. Init project
echo -e "\n${YELLOW}Step 2/4${NC} — Creating project"
railway init --name transact-rank

# 4. Deploy the backend (Dockerfile is auto-detected)
echo -e "\n${YELLOW}Step 3/4${NC} — Deploying backend"
railway up --detach

# 5. Add Postgres and get the URL
echo -e "\n${YELLOW}Step 4/4${NC} — Adding PostgreSQL"
echo ""
echo "  Open your Railway project dashboard and:"
echo "  1. Click  New  → Database → Add PostgreSQL"
echo "  2. Railway injects DATABASE_URL automatically"
echo "  3. The service redeploys; tables are created on first boot"
echo ""

# Print the service URL
echo -e "${GREEN}Backend URL:${NC}"
railway domain 2>/dev/null || echo "  Run 'railway domain' after Postgres is added to get your URL"

echo ""
echo -e "${GREEN}Done! Next:${NC}"
echo "  • Copy your Railway URL"
echo "  • Open transact-rank.jsx"
echo "  • Change: const BACKEND_URL = null;"
echo "  • To:     const BACKEND_URL = \"https://your-url.railway.app\";"
