FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# shortcut: Alpine's chromium follows the base image's repository, not an exact version; pin it when a mirror exists.
RUN apk add --no-cache chromium
WORKDIR /app
COPY _bot/package.json _bot/package-lock.json /app/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY _lab/ /app/_lab/
COPY _bot/bot.mjs /app/server.mjs
# Chromium writes caches under HOME; only /tmp is writable.
ENV HOME=/tmp
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 CMD ["node", "/app/_lab/healthcheck.mjs"]
CMD ["node", "/app/server.mjs"]
