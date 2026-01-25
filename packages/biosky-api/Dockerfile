FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-api/package.json ./packages/biosky-api/
COPY packages/biosky-shared/package.json ./packages/biosky-shared/

RUN npm ci

COPY . .
RUN npm run build -w biosky-shared -w biosky-api

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-api/package.json ./packages/biosky-api/
COPY packages/biosky-shared/package.json ./packages/biosky-shared/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/biosky-api/dist ./packages/biosky-api/dist
COPY --from=builder /app/packages/biosky-shared/dist ./packages/biosky-shared/dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/biosky-api/dist/server.js"]
