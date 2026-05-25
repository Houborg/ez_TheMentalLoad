# Stage 1: Extract git info (tiny image, discarded after)
FROM alpine/git:latest AS git-info
WORKDIR /src
COPY .git .git
COPY package.json package.json
RUN echo "$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')" > /tmp/git-commit.txt \
 && grep -o '"version": *"[^"]*"' package.json | head -1 | grep -o '[0-9][0-9.]*' > /tmp/git-version.txt \
 && echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /tmp/git-time.txt

# Stage 2: Build the frontend
FROM node:20-alpine AS base
WORKDIR /app

# Copy git info from first stage
COPY --from=git-info /tmp/git-commit.txt /tmp/git-version.txt /tmp/git-time.txt /tmp/

COPY package*.json ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/e2e/package.json ./packages/e2e/package.json
RUN npm install
COPY . .
# Remove .git from the build image (only needed in stage 1)
RUN rm -rf .git

ARG NEXT_PUBLIC_WS_URL
# NEXT_PUBLIC_* vars must be present at build time for Next.js to inline them.
# Values are auto-detected from git; pass BUILD_VERSION / BUILD_COMMIT to override.
ARG BUILD_VERSION=
ARG BUILD_COMMIT=
ARG BUILD_TIME=
RUN VERSION="${BUILD_VERSION:-$(cat /tmp/git-version.txt)}" \
 && COMMIT="${BUILD_COMMIT:-$(cat /tmp/git-commit.txt)}" \
 && TIME="${BUILD_TIME:-$(cat /tmp/git-time.txt)}" \
 && echo "Building frontend v${VERSION} (${COMMIT}) at ${TIME}" \
 && export NEXT_PUBLIC_APP_VERSION="$VERSION" \
 && export NEXT_PUBLIC_APP_COMMIT="$COMMIT" \
 && export NEXT_PUBLIC_DEPLOY_TIME="$TIME" \
 && export NEXT_PUBLIC_WS_URL="$NEXT_PUBLIC_WS_URL" \
 && npm --workspace @mental-load/frontend run build

# The ENV below is for runtime (server-side rendering); the inlined values
# from the build step above are what the browser-side bundle sees.
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

EXPOSE 4173
CMD ["npm", "--workspace", "@mental-load/frontend", "run", "start"]
