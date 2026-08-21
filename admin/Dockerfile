FROM node:20-slim

RUN apt-get update && apt-get install -y \
  libvips-dev \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependency layer ────────────────────────────────────────────────────────
#
# The version field is stripped from *both* package.json and package-lock.json
# before `npm ci`, so a release bump cannot invalidate this layer.
#
# This matters more than it looks. `npm version` rewrites the version in the
# lockfile as well as package.json, and on a bump those two fields are the only
# thing that changes in either file. Stripping package.json alone — as this
# Dockerfile used to — still left the lockfile changing on every release, which
# busted the cache and forced a full dependency reinstall on every deploy.
#
# `npm ci` cross-checks package.json against the lockfile, so both must be
# stripped together to stay consistent.
COPY package.json package-lock.json ./deps/
RUN node -e "const fs=require('fs'); \
  const p=require('./deps/package.json'); delete p.version; \
  fs.writeFileSync('package.json', JSON.stringify(p)); \
  const l=require('./deps/package-lock.json'); delete l.version; \
  if (l.packages && l.packages['']) delete l.packages[''].version; \
  fs.writeFileSync('package-lock.json', JSON.stringify(l));" \
  && rm -rf ./deps

RUN npm ci

# ── Application layer ───────────────────────────────────────────────────────
# Restores the real package.json (with its version — the site footer reads it)
# and builds. See .dockerignore for what is kept out of the context.
COPY . .
RUN npm run build

EXPOSE 3000

ENV DATABASE_URL=file:/data/positron.db
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start"]
