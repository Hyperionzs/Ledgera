# ============================================================================
# Ledgera Frontend — Multi-stage Dockerfile
# Stage 1: Build the Vite app
# Stage 2: Serve with Nginx
# ============================================================================

# --- Stage 1: Build ---
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

# Copy package.json for each workspace package
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ ./packages/shared/
COPY apps/frontend/ ./apps/frontend/

# Build the frontend
WORKDIR /app/apps/frontend
RUN pnpm run build

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine AS production

# Copy custom nginx config
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
