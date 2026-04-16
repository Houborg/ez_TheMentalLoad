FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/e2e/package.json ./packages/e2e/package.json
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=base /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "--workspace", "@mental-load/backend", "run", "start"]
