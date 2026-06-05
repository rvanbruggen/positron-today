FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

ENV DATABASE_URL=file:/data/positron.db
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
