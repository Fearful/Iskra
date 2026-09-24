# ─── Simple Server ──────────────────────────────────────────────────────────
# Build from the repository root: docker build -f templates/simple-server/Dockerfile .

# ─── Stage 1: Dependencies ───────────────────────────────────────────────────
# The Bun the monorepo is pinned to, which reads bun.lockb.
FROM oven/bun:1.1.38 AS deps

WORKDIR /build

# The whole workspace, filtered by the root .dockerignore: the lockfile covers
# every workspace, so copying only some of them fails --frozen-lockfile.
COPY . .
RUN bun install --frozen-lockfile

# ─── Stage 2: Build ──────────────────────────────────────────────────────────
# Compiled with a newer Bun: 1.1.38's bundler emits a binary that fails to
# start ("Cannot declare a function that shadows ..." in confbox, which the
# config loader uses).
FROM oven/bun:1.3.14 AS builder

WORKDIR /build
COPY --from=deps /build /build

# bun build inlines process.env.NODE_ENV ("development" unless set here), so
# the runtime environment cannot change it: without this the binary runs in
# development mode (stack traces in error responses, non-Secure session
# cookies, pretty logs).
ENV NODE_ENV=production

RUN bun build templates/simple-server/src/main.ts --compile --outfile=/build/app

# ─── Stage 3: Runtime (UBI9 Minimal) ─────────────────────────────────────────
# The compiled binary needs only glibc, which ubi-minimal ships: no package
# installs, so this stage also builds offline or behind a TLS-inspecting proxy.
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest

WORKDIR /app
COPY --from=builder --chown=1001:0 /build/app /app/app

ENV NODE_ENV=production

# Non-root, arbitrary UID in group 0 (OpenShift convention).
USER 1001:0
EXPOSE 3000

ENTRYPOINT ["/app/app"]
