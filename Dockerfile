FROM --platform=$BUILDPLATFORM node:24-alpine AS geoip
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY data/geoip-source.json ./data/geoip-source.json
COPY scripts/download-geoip.mjs ./scripts/download-geoip.mjs
RUN npm run geoip:download

FROM node:24-alpine

LABEL org.opencontainers.image.title="Just Blame Cloudflare" \
      org.opencontainers.image.description="A simulated Cloudflare outage page with automatic hostname and offline GeoIP location estimates." \
      org.opencontainers.image.source="https://github.com/theodorecharles/JustBlameCloudflare" \
      org.opencontainers.image.url="https://github.com/theodorecharles/JustBlameCloudflare" \
      org.opencontainers.image.licenses="MIT AND CC-BY-4.0 AND LicenseRef-Cloudflare-Assets"

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 TRUST_PROXY=false

COPY --chown=node:node package.json geoip.js server.js start.js LICENSE THIRD_PARTY.md ./
COPY --from=geoip --chown=node:node /build/node_modules ./node_modules/
COPY --from=geoip --chown=node:node /build/data/dbip-city-lite.mmdb ./data/dbip-city-lite.mmdb
COPY --chown=node:node data/locations.json data/geoip-source.json ./data/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node templates/error.html ./templates/error.html

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/_outage/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "start.js"]
