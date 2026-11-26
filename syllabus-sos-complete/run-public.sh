#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "=========================================================="
echo "  SyllabusSOS++ Cloudflare Quick Tunnel Launcher          "
echo "=========================================================="

if ! command -v cloudflared &>/dev/null; then
  echo "Error: cloudflared is not installed or not in PATH."
  exit 1
fi

ENV_LOCAL="$ROOT/.env.local"
APP_SECRET=""
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

if [ -f "$ENV_LOCAL" ]; then
  APP_SECRET=$(grep -E '^APP_SECRET=' "$ENV_LOCAL" | cut -d= -f2- || true)
  if [ -z "$ADMIN_EMAIL" ]; then
    ADMIN_EMAIL=$(grep -E '^ADMIN_EMAIL=' "$ENV_LOCAL" | cut -d= -f2- || true)
  fi
fi

if [ -z "$APP_SECRET" ] || [ ${#APP_SECRET} -lt 32 ]; then
  echo "[*] Generating fresh persistent APP_SECRET..."
  APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
fi

if [ -z "$ADMIN_EMAIL" ]; then
  if [ -t 0 ]; then
    read -r -p "Enter administrator email (stored in .env.local): " ADMIN_EMAIL || true
  fi
  [ -z "$ADMIN_EMAIL" ] && ADMIN_EMAIL="admin@syllabus-sos.local"
fi

cat <<EOF > "$ENV_LOCAL"
# Local machine secrets - ignored by git
APP_SECRET=$APP_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_INITIALIZED=true
EOF
chmod 600 "$ENV_LOCAL" 2>/dev/null || true

mkdir -p "$ROOT/data"
TUNNEL_LOG="$ROOT/data/tunnel.log"
rm -f "$TUNNEL_LOG"

echo "[*] Starting cloudflared tunnel to http://127.0.0.1:3000..."
cloudflared tunnel --url http://127.0.0.1:3000 >/dev/null 2>"$TUNNEL_LOG" &
TUNNEL_PID=$!

cleanup() {
  echo ""
  echo "[*] Shutting down Cloudflare tunnel ($TUNNEL_PID)..."
  kill "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PUBLIC_URL=""
for i in {1..60}; do
  if [ -f "$TUNNEL_LOG" ]; then
    PUBLIC_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)
    if [ -n "$PUBLIC_URL" ]; then
      break
    fi
  fi
  sleep 0.5
done

if [ -z "$PUBLIC_URL" ]; then
  echo "Failed to obtain tunnel address. Check $TUNNEL_LOG"
  exit 1
fi

ALLOWED_HOST=$(echo "$PUBLIC_URL" | sed 's|https://||')

echo "[✓] Public tunnel established: $PUBLIC_URL"

export NODE_ENV=production
export HOST=127.0.0.1
export PORT=3000
export TRUST_PROXY=true
export PUBLIC_URL="$PUBLIC_URL"
export ALLOWED_HOSTS="$ALLOWED_HOST"
export APP_SECRET="$APP_SECRET"
export PAYMENTS_MODE=test
export DEMO_MODE=true
export DATABASE_PATH="./data/syllabussos.db"
export ADMIN_EMAIL="$ADMIN_EMAIL"

echo "[*] Seeding database..."
node --disable-warning=ExperimentalWarning server/seed.js

echo ""
echo "=========================================================="
echo "  SyllabusSOS++ IS LIVE ON THE PUBLIC INTERNET!           "
echo "  Public URL   : $PUBLIC_URL"
echo "  Admin Email  : $ADMIN_EMAIL"
echo "  Database     : $ROOT/data/syllabussos.db"
echo "=========================================================="
echo "Press Ctrl+C to stop the server and tunnel."
echo ""

node --disable-warning=ExperimentalWarning server/index.js
