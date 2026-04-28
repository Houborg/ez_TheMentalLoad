FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/e2e/package.json ./packages/e2e/package.json
RUN npm install
COPY . .
ARG NEXT_PUBLIC_WS_URL
ARG BUILD_VERSION=0.0.0-dev
ARG BUILD_COMMIT=local
ARG BUILD_TIME=
# NEXT_PUBLIC_* vars must be present at build time for Next.js to inline them
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_APP_VERSION=$BUILD_VERSION \
    NEXT_PUBLIC_APP_COMMIT=$BUILD_COMMIT \
    NEXT_PUBLIC_DEPLOY_TIME=$BUILD_TIME
RUN npm --workspace @mental-load/frontend run build
EXPOSE 4173
CMD ["npm", "--workspace", "@mental-load/frontend", "run", "start"]
