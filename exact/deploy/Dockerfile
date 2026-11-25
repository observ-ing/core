# The built site on Cloud Run: deploy/site.ts serving dist/. Its context is
# staged by deploy/stage.sh: dist/ beside site.ts.
FROM oven/bun:1.3-slim
WORKDIR /app
COPY . .
ENV SITE=/app/dist PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "site.ts"]
