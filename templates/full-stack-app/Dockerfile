# ─── Full-Stack App ─────────────────────────────────────────────────────────
# Build from the repository root: docker build -f templates/full-stack-app/Dockerfile .

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

RUN bun build templates/full-stack-app/src/main.ts --compile --outfile=/build/app
# The process-kit worker runs as its own binary: the runtime image has no bun.
RUN bun build templates/full-stack-app/src/scripts/worker.js --compile --outfile=/build/worker

# ─── Stage 2: Runtime (UBI9 Minimal) ─────────────────────────────────────────
# The compiled binary needs only glibc, which ubi-minimal ships: no package
# installs, so this stage also builds offline or behind a TLS-inspecting proxy.
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

WORKDIR /app
COPY --from=builder --chown=1001:0 /build/app /app/app
COPY --from=builder --chown=1001:0 /build/worker /app/worker
ENV WORKER_COMMAND=/app/worker NODE_ENV=production

# Non-root, arbitrary UID in group 0 (OpenShift convention).
USER 1001:0
EXPOSE 3000 3001

ENTRYPOINT ["/app/app"]
