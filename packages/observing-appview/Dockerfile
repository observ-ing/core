FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/observing-lexicon/package.json ./packages/observing-lexicon/
COPY packages/observing-shared/package.json ./packages/observing-shared/
COPY packages/observing-appview/package.json ./packages/observing-appview/
COPY packages/observing-frontend/package.json ./packages/observing-frontend/

RUN npm ci

COPY . .
RUN npm run build -w observing-lexicon -w observing-shared -w observing-appview -w observing-frontend

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/observing-lexicon/package.json ./packages/observing-lexicon/
COPY packages/observing-shared/package.json ./packages/observing-shared/
COPY packages/observing-appview/package.json ./packages/observing-appview/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/observing-lexicon/dist ./packages/observing-lexicon/dist
COPY --from=builder /app/packages/observing-shared/dist ./packages/observing-shared/dist
COPY --from=builder /app/packages/observing-shared/openapi.json ./packages/observing-shared/openapi.json
COPY --from=builder /app/packages/observing-appview/dist ./packages/observing-appview/dist
COPY --from=builder /app/dist/public ./dist/public

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/observing-appview/dist/api.js"]
