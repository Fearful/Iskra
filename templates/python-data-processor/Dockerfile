# ─── Python Data Processor ──────────────────────────────────────────────────
# Build from the repository root: docker build -f templates/python-data-processor/Dockerfile .

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# The Bun the monorepo is pinned to (.bun-version).
FROM oven/bun:1.3.14 AS builder

WORKDIR /build

# The whole workspace, filtered by the root .dockerignore: the lockfile covers
# every workspace, so copying only some of them fails --frozen-lockfile.
COPY . .
RUN bun install --frozen-lockfile

# bun build inlines process.env.NODE_ENV ("development" unless set here), so
# the runtime environment cannot change it: without this the binary runs in
# development mode (stack traces in error responses, non-Secure session
# cookies, pretty logs).
ENV NODE_ENV=production

RUN bun build templates/python-data-processor/src/main.ts --compile --outfile=/build/app

# ─── Stage 2: Runtime (UBI9 Minimal + Python) ────────────────────────────────
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

# Python runs the process-kit sidecar (the only package this image installs).
RUN microdnf install -y python3 && microdnf clean all

WORKDIR /app
COPY --from=builder --chown=1001:0 /build/app /app/app
# The sidecar is spawned as `python3 src/scripts/process.py` from /app.
COPY --chown=1001:0 templates/python-data-processor/src/scripts/ /app/src/scripts/

ENV NODE_ENV=production

# Non-root, arbitrary UID in group 0 (OpenShift convention).
USER 1001:0
EXPOSE 3000

ENTRYPOINT ["/app/app"]
