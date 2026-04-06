#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  Positiviteiten — start all services
#
#  Starts:
#    • Ollama          local LLM (skipped if already running)
#    • Admin           Next.js   → http://localhost:3000
#    • Public site     Eleventy  → http://localhost:8080/positiviteiten/
#
#  Logs are written to .ollama.log / .admin.log / .site.log
#  Run ./stop.sh to shut everything down again.
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo "🌟  Starting Positiviteiten v$(node -p "require('./package.json').version" 2>/dev/null || echo '?')..."
echo ""

# ── Ollama (local LLM) ────────────────────────────────────────────────────────
if pgrep -x ollama >/dev/null 2>&1; then
  echo "  ✓  Ollama — already running (will not be stopped by stop.sh)"
  touch "$REPO/.ollama-external"
else
  rm -f "$REPO/.ollama-external"
  ollama serve >"$REPO/.ollama.log" 2>&1 &
  echo "  ✓  Ollama — started  (log: .ollama.log)"
fi

# ── Admin — Next.js ───────────────────────────────────────────────────────────
cd "$REPO/admin"
npm run dev >"$REPO/.admin.log" 2>&1 &
echo "  ✓  Admin  — http://localhost:3000  (log: .admin.log)"

# ── Public site — Eleventy ────────────────────────────────────────────────────
cd "$REPO/site"
npm run dev >"$REPO/.site.log" 2>&1 &
echo "  ✓  Site   — http://localhost:8080/positiviteiten/  (log: .site.log)"

echo ""
echo "🟢  All services running."
echo "    Run  ./stop.sh  to shut everything down."
echo ""
