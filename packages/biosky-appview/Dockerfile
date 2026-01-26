FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-shared/package.json ./packages/biosky-shared/
COPY packages/biosky-appview/package.json ./packages/biosky-appview/
COPY packages/biosky-frontend/package.json ./packages/biosky-frontend/

RUN npm ci

COPY . .
RUN npm run build -w biosky-shared -w biosky-appview -w biosky-frontend

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/biosky-shared/package.json ./packages/biosky-shared/
COPY packages/biosky-appview/package.json ./packages/biosky-appview/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/biosky-shared/dist ./packages/biosky-shared/dist
COPY --from=builder /app/packages/biosky-shared/openapi.json ./packages/biosky-shared/openapi.json
COPY --from=builder /app/packages/biosky-appview/dist ./packages/biosky-appview/dist
COPY --from=builder /app/dist/public ./dist/public

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/biosky-appview/dist/api.js"]
