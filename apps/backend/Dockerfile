# ============================================================================
# NexusPOS Backend — Multi-stage Dockerfile
# Stage 1: Install dependencies
# Stage 2: Build application
# Stage 3: Production runtime (minimal image)
# ============================================================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy package.json for each workspace package
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# --- Stage 2: Build ---
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules 2>/dev/null || true

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY apps/backend/ ./apps/backend/
COPY package.json pnpm-workspace.yaml .npmrc ./

# Generate Prisma client
WORKDIR /app/apps/backend
RUN npx prisma generate

# Build NestJS
RUN pnpm run build

# --- Stage 3: Production ---
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Add non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

WORKDIR /app

# Copy built artifacts
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/node_modules ./node_modules
COPY --from=build /app/apps/backend/prisma ./prisma
COPY --from=build /app/apps/backend/package.json ./

# Copy Prisma generated client
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main"]
