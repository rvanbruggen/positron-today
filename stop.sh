#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  Positiviteiten — stop all services
#
#  Stops processes on ports 3000 (admin) and 8080 (site).
#  Stops Ollama only if start.sh started it (i.e. it was not
#  already running before you ran start.sh).
# ─────────────────────────────────────────────────────────────────

REPO="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "🛑  Stopping Positiviteiten..."
echo ""

# ── Admin (port 3000) ─────────────────────────────────────────────────────────
PIDS=$(lsof -ti tcp:3000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
  echo "  ✓  Admin stopped  (port 3000)"
else
  echo "  –  Admin not running"
fi

# ── Public site (port 8080) ───────────────────────────────────────────────────
PIDS=$(lsof -ti tcp:8080 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
  echo "  ✓  Site stopped   (port 8080)"
else
  echo "  –  Site not running"
fi

# ── Ollama — only if we started it ───────────────────────────────────────────
if [ -f "$REPO/.ollama-external" ]; then
  echo "  –  Ollama left running (was already running before start.sh)"
  rm -f "$REPO/.ollama-external"
else
  if pkill -x ollama 2>/dev/null; then
    echo "  ✓  Ollama stopped"
  else
    echo "  –  Ollama not running"
  fi
fi

echo ""
echo "🔴  Done."
echo ""
