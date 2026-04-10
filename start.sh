#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  Positron Today — start all services
#
#  Starts:
#    • Ollama          local LLM → http://localhost:11434
#    • Admin           Next.js   → http://localhost:3000
#    • Public site     Eleventy  → http://localhost:8080
#
#  Logs are written to .ollama.log / .admin.log / .site.log
#  Run ./stop.sh to shut everything down again.
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo "🌟  Starting Positron Today v$(node -p "require('./package.json').version" 2>/dev/null || echo '?')..."
echo ""

# ── Ollama (local LLM) ────────────────────────────────────────────────────────
if pgrep -x ollama >/dev/null 2>&1; then
  echo "  ✓  Ollama — already running (will not be stopped by stop.sh)"
  echo "             http://localhost:11434"
  touch "$REPO/.ollama-external"
else
  rm -f "$REPO/.ollama-external"
  ollama serve >"$REPO/.ollama.log" 2>&1 &
  echo "  ✓  Ollama — started  → http://localhost:11434  (log: .ollama.log)"
  # Open a new Terminal window tailing the Ollama log so activity is visible
  sleep 1
  osascript -e "tell application \"Terminal\" to do script \"echo '── Ollama activity log ──'; tail -f \\\"$REPO/.ollama.log\\\"\"" >/dev/null 2>&1 || true
fi

# ── Admin — Next.js ───────────────────────────────────────────────────────────
cd "$REPO/admin"
npm run dev >"$REPO/.admin.log" 2>&1 &
echo "  ✓  Admin  — http://localhost:3000  (log: .admin.log)"

# ── Public site — Eleventy ────────────────────────────────────────────────────
cd "$REPO/site"
npm run dev >"$REPO/.site.log" 2>&1 &
echo "  ✓  Site   — http://localhost:8080  (log: .site.log)"

echo ""
echo "🟢  All services running."
echo "    Run  ./stop.sh  to shut everything down."
echo ""

# ── Open admin in browser once it's ready ─────────────────────────────────────
echo "  ⏳  Waiting for admin to be ready…"
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:3000; then
    open http://localhost:3000
    echo "  ✓  Opened http://localhost:3000 in browser"
    break
  fi
  sleep 1
done
