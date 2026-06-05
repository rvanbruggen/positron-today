FROM node:20

RUN apt-get update && apt-get install -y \
  libvips-dev \
  build-essential \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

ENV DATABASE_URL=file:/data/positron.db
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start"]
