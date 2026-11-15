# The web app and its server.ts proxy, in front of a real appview, on Cloud Run.
# Built by deploy/deploy.sh from a staged context: dist/ (web-build) beside the
# server's sources.
FROM oven/bun:1.3-slim
WORKDIR /app
COPY . .
ENV SITE=/app/dist PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "server.ts"]
