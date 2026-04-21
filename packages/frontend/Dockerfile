FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/e2e/package.json ./packages/e2e/package.json
RUN npm install
COPY . .
RUN npm --workspace @mental-load/frontend run build
EXPOSE 4173
CMD ["npm", "--workspace", "@mental-load/frontend", "run", "start"]
