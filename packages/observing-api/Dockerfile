FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/observing-lexicon/package.json ./packages/observing-lexicon/
COPY packages/observing-api/package.json ./packages/observing-api/
COPY packages/observing-shared/package.json ./packages/observing-shared/

RUN npm ci

COPY . .
RUN npm run build -w observing-lexicon -w observing-shared -w observing-api

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/observing-lexicon/package.json ./packages/observing-lexicon/
COPY packages/observing-api/package.json ./packages/observing-api/
COPY packages/observing-shared/package.json ./packages/observing-shared/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/observing-lexicon/dist ./packages/observing-lexicon/dist
COPY --from=builder /app/packages/observing-api/dist ./packages/observing-api/dist
COPY --from=builder /app/packages/observing-shared/dist ./packages/observing-shared/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/observing-api/dist/server.js"]
