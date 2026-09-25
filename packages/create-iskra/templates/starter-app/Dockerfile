# ─── Starter App ────────────────────────────────────────────────────────────
# Build: docker build -t starter-app .
# Needs the lockfile: run `bun install` once before the first build.

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM oven/bun:1.3.14 AS builder

WORKDIR /build

# Dependencies first, so this layer is reused until package.json or the
# lockfile change.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# bun build inlines process.env.NODE_ENV ("development" unless set here), so
# the runtime environment cannot change it: without this the binary runs in
# development mode (stack traces in error responses, non-Secure session
# cookies, pretty logs).
ENV NODE_ENV=production
RUN bun build src/main.ts --compile --outfile=/build/app

# ─── Stage 2: Runtime (UBI9 Minimal) ─────────────────────────────────────────
# The compiled binary needs only glibc, which ubi-minimal ships: no package
# installs, so this stage also builds offline or behind a TLS-inspecting proxy.
# A fixed release (Red Hat still rebuilds the 9.8 tag with security fixes):
# with :latest any rebuild could move to another release. Bump it on purpose.
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.8

WORKDIR /app
# Root-owned and read-only (0555): copied with --chown=1001:0, the user the
# app runs as could overwrite its own code, so a compromise could persist.
COPY --from=builder --chmod=0555 /build/app /app/app

ENV NODE_ENV=production

# Non-root, arbitrary UID in group 0 (OpenShift convention).
USER 1001:0
EXPOSE 3000

ENTRYPOINT ["/app/app"]
