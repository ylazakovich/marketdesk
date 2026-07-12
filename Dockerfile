# Stage 1: Dependencies and build (needs devDependencies for tsc + vite).
FROM node:20-alpine AS builder

WORKDIR /app

# Native build toolchain (some transitive deps compile from source).
RUN apk add --no-cache python3 make g++

# Install ALL dependencies (dev included) so the backend (tsc) and frontend (vite)
# build toolchains are available.
COPY package*.json ./
RUN npm ci

# Copy source and build both the backend (-> dist/backend) and the frontend
# (-> dist/frontend, served statically by the backend).
COPY . .
RUN npm run build

# Drop devDependencies so only production modules are carried into the runtime image.
RUN npm prune --omit=dev

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# dumb-init for proper signal handling / zombie reaping.
RUN apk add --no-cache dumb-init

# Non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy pruned production node_modules + build output + metadata.
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/src/backend/persistence/migrations ./migrations

USER nodejs

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# main.js serves the API and, when dist/frontend exists (it does in this image), the
# built SPA on the same port.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/backend/main.js"]
