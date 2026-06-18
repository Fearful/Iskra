# ─── Form Manager ─────────────────────────────────────────────────────────────
# Build: docker build -f templates/forms-app/services/form-manager/Dockerfile .
# NOTE: This service needs Vite at runtime, so we use bun:1 as the runtime image.

FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* tsconfig.base.json ./
COPY packages/ packages/
COPY templates/forms-app/ templates/forms-app/

RUN bun install --frozen-lockfile --production

WORKDIR /app/templates/forms-app/services/form-manager

RUN mkdir -p /app/static

USER bun
EXPOSE 4001

ENTRYPOINT ["bun", "run", "src/main.ts"]
