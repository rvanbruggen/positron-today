#!/bin/bash
# publish-scheduled.sh
#
# Calls the admin's /api/publish-scheduled endpoint to publish any articles
# whose scheduled time has arrived. Designed to be run by launchd every hour.
#
# Setup (one-time):
#   chmod +x scripts/publish-scheduled.sh
#   cp scripts/today.positron.publish-scheduled.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/today.positron.publish-scheduled.plist

ADMIN_URL="${POSITRON_ADMIN_URL:-http://localhost:3000}"
LOG_FILE="${HOME}/Library/Logs/positron-publish-scheduled.log"

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

echo "[$(timestamp)] Checking for scheduled articles at ${ADMIN_URL}…" >> "$LOG_FILE"

RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/publish-scheduled" \
  -H "Content-Type: application/json" \
  --max-time 120 \
  2>> "$LOG_FILE")

if [ $? -ne 0 ]; then
  echo "[$(timestamp)] ERROR: curl failed (is the admin running?)" >> "$LOG_FILE"
  exit 1
fi

echo "[$(timestamp)] Response: ${RESPONSE}" >> "$LOG_FILE"
