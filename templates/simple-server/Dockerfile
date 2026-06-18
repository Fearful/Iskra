# ─── Simple Server ────────────────────────────────────────────────────────────
# Build: docker build -f templates/simple-server/Dockerfile .

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /build

COPY package.json bun.lock* tsconfig.base.json ./
COPY packages/ packages/
COPY templates/simple-server/ templates/simple-server/

RUN bun install --frozen-lockfile --production

RUN bun build \
    templates/simple-server/src/main.ts \
    --compile \
    --target=bun-linux-x64 \
    --outfile=/build/app

# ─── Stage 2: Runtime (UBI9 Minimal) ─────────────────────────────────────────
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

RUN microdnf install -y libstdc++ shadow-utils && \
    useradd -u 1001 -r -g 0 -s /sbin/nologin iskra && \
    microdnf remove -y shadow-utils && \
    microdnf clean all

WORKDIR /app
COPY --from=builder --chown=1001:0 /build/app /app/app

USER 1001
EXPOSE 3000

ENTRYPOINT ["/app/app"]
