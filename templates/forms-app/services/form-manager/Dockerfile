# ─── Form Manager ───────────────────────────────────────────────────────────
# Build from the repository root: docker build -f templates/forms-app/services/form-manager/Dockerfile .
# Runs from source on the Bun image: the service uses Vite at runtime.

FROM oven/bun:1.3.14

WORKDIR /app

# The whole workspace, filtered by the root .dockerignore: the lockfile covers
# every workspace, so copying only some of them fails --frozen-lockfile.
COPY . .
RUN bun install --frozen-lockfile --production

WORKDIR /app/templates/forms-app/services/form-manager

# Written here, read by forms-api through the static-forms volume. Both images
# run as UID 1001 / group 0 with this directory group-writable: the volume takes
# its owner from whichever container mounts it first.
RUN mkdir -p /app/static && chown 1001:0 /app/static && chmod 2775 /app/static

ENV NODE_ENV=production HOME=/tmp
USER 1001:0
EXPOSE 4001

ENTRYPOINT ["bun", "run", "src/main.ts"]
