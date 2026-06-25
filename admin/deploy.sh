#!/bin/bash
set -e

cd ~/positron-today
echo "Pulling latest code..."
git pull

cd admin
echo "Stopping old containers..."
docker compose down --remove-orphans
echo "Rebuilding and restarting..."
docker compose build --no-cache
docker compose up -d

echo "Done. Waiting for startup..."
sleep 3
docker compose logs --tail 5
