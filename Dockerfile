FROM node:24-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

FROM node:24-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json

RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/artifacts/api-server/dist ./artifacts/api-server/dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
