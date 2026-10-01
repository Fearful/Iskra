# ─── CMS Starter ────────────────────────────────────────────────────────────
# Build from the repository root: docker build -f templates/cms-starter/Dockerfile .

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# The Bun the monorepo is pinned to (.bun-version).
FROM oven/bun:1.4.2 AS builder

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

RUN bun build templates/cms-starter/src/main.ts --compile --outfile=/build/app

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

# The SQLite file lives in a directory the runtime user can write: /app itself
# is root's, so the default relative path (cms.db) could not be created and the
# app failed to start. Group 0 gets the owner's rights for an arbitrary UID.
# Mount a volume here to keep the data: -v cms-starter-data:/app/data
RUN mkdir -p /app/data && chown 1001:0 /app/data && chmod 2775 /app/data
ENV DATABASE_URL=/app/data/cms.db

ENV NODE_ENV=production

# Non-root, arbitrary UID in group 0 (OpenShift convention).
USER 1001:0
EXPOSE 3000

ENTRYPOINT ["/app/app"]
