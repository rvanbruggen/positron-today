#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  Positron Today — stop all services
#
#  Usage:
#    ./stop.sh               — stops Admin + Site only, leaves Ollama alone
#    ./stop.sh --with-ollama — stops Admin + Site + Ollama (if started by start.sh)
#
#  Stops Ollama only if start.sh started it (i.e. it was not
#  already running before you ran start.sh), unless --no-ollama
#  is passed, in which case Ollama is always left alone.
# ─────────────────────────────────────────────────────────────────

REPO="$(cd "$(dirname "$0")" && pwd)"

# ── Parse flags ───────────────────────────────────────────────────
WITH_OLLAMA=false
for arg in "$@"; do
  case "$arg" in
    --with-ollama) WITH_OLLAMA=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

echo ""
echo "🛑  Stopping Positron Today..."
echo ""

# ── Admin (port 3000) ─────────────────────────────────────────────
PIDS=$(lsof -ti tcp:3000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
  echo "  ✓  Admin stopped  (port 3000)"
else
  echo "  –  Admin not running"
fi

# ── Public site (port 8080) ───────────────────────────────────────
PIDS=$(lsof -ti tcp:8080 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
  echo "  ✓  Site stopped   (port 8080)"
else
  echo "  –  Site not running"
fi

# ── Ollama ────────────────────────────────────────────────────────
if [ "$WITH_OLLAMA" = false ]; then
  echo "  –  Ollama left running (use --with-ollama to stop it)"
elif [ -f "$REPO/.ollama-external" ]; then
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
