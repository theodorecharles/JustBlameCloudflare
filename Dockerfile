FROM node:24-alpine

LABEL org.opencontainers.image.title="Just Blame Cloudflare" \
      org.opencontainers.image.description="A simulated Cloudflare outage page with automatic hostname and data-center detection." \
      org.opencontainers.image.source="https://github.com/theodorecharles/JustBlameCloudflare" \
      org.opencontainers.image.url="https://github.com/theodorecharles/JustBlameCloudflare" \
      org.opencontainers.image.licenses="MIT AND LicenseRef-Cloudflare-Assets"

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 TRUST_PROXY=false

COPY --chown=node:node package.json server.js start.js LICENSE THIRD_PARTY.md ./
COPY --chown=node:node public/ ./public/
COPY --chown=node:node templates/error.html ./templates/error.html

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/_outage/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "start.js"]
