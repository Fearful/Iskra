# ─── Python Data Processor ───────────────────────────────────────────────────
# Build: docker build -f templates/python-data-processor/Dockerfile .
# Nota: este template necesita Python en runtime para el sidecar de proceso.

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /build

COPY package.json bun.lock* tsconfig.base.json ./
COPY packages/ packages/
COPY templates/python-data-processor/ templates/python-data-processor/

RUN bun install --frozen-lockfile --production

RUN bun build \
    templates/python-data-processor/src/main.ts \
    --compile \
    --target=bun-linux-x64 \
    --outfile=/build/app

# ─── Stage 2: Runtime (UBI9 Minimal + Python) ────────────────────────────────
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

RUN microdnf install -y libstdc++ shadow-utils python3 && \
    useradd -u 1001 -r -g 0 -s /sbin/nologin iskra && \
    microdnf remove -y shadow-utils && \
    microdnf clean all

WORKDIR /app

# Copiar binario compilado
COPY --from=builder --chown=1001:0 /build/app /app/app

# Copiar scripts Python necesarios para el process-kit
COPY --chown=1001:0 templates/python-data-processor/src/scripts/ /app/scripts/

USER 1001
EXPOSE 3000

ENTRYPOINT ["/app/app"]
