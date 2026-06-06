FROM node:20-slim

RUN apt-get update && apt-get install -y \
  libvips-dev \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package-lock.json ./
COPY package.json ./tmp-package.json
RUN node -e "const p=require('./tmp-package.json'); delete p.version; require('fs').writeFileSync('package.json',JSON.stringify(p))"
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

ENV DATABASE_URL=file:/data/positron.db
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start"]
