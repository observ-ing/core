FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-media-proxy/package.json ./packages/biosky-media-proxy/

RUN npm ci

COPY . .
RUN npm run build -w biosky-media-proxy

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-media-proxy/package.json ./packages/biosky-media-proxy/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/biosky-media-proxy/dist ./packages/biosky-media-proxy/dist

# Create cache directory
RUN mkdir -p /app/cache/media

ENV NODE_ENV=production
ENV PORT=8080
ENV MEDIA_PROXY_PORT=8080
ENV CACHE_DIR=/app/cache/media

EXPOSE 8080

CMD ["node", "packages/biosky-media-proxy/dist/index.js"]
