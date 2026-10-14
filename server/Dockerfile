# SHMS API container (Part P1).
#
#   docker build -t shms-api server
#   docker run --env-file server/.env -p 4000:4000 shms-api
#
# Migrations never run on boot. Run them as the host's release command (or by
# hand) before the new version takes traffic:
#   docker run --rm --env-file server/.env shms-api npm run migrate up
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

# Production dependencies only. node-pg-migrate is one of them because the
# release command runs it from this image. bcrypt ships a musl prebuild, so
# no compiler is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY migrations ./migrations
COPY src ./src

# The node image's unprivileged user. Nothing in /app is writable by it.
USER node

EXPOSE 4000

# /api/health answers 200 only when the database answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/server.js"]
