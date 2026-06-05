#!/bin/bash
set -e

cd ~/positron-today
echo "Pulling latest code..."
git pull

cd admin
echo "Rebuilding and restarting..."
docker compose up -d --build

echo "Done. Waiting for startup..."
sleep 3
docker compose logs --tail 5
