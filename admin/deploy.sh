#!/bin/bash
set -e

cd ~/positron-today
echo "Pulling latest code..."
git pull

cd admin
echo "Rebuilding and restarting..."
# Build first, then recreate — `up --build` does both in that order, so the
# running container keeps serving for the whole build. The old `down` before
# this took the site offline from that moment until the new image was ready,
# which on a cold build is minutes rather than seconds.
docker compose up -d --build --remove-orphans

echo "Done. Waiting for startup..."
sleep 3
docker compose logs --tail 5
