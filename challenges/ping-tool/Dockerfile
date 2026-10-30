FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

WORKDIR /app
COPY --chown=65532:65532 _lab/ /app/_lab/
COPY --chown=65532:65532 ping-tool/server.mjs /app/server.mjs
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 CMD ["node", "/app/_lab/healthcheck.mjs"]
CMD ["node", "/app/server.mjs"]
