# ─── Admin Frontend ──────────────────────────────────────────────────────────
# Build from the repository root:
#   docker build -f templates/forms-app/services/admin-frontend/Dockerfile .

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# Built with the monorepo's Bun (.bun-version): the app depends on @forms-app/shared through
# `workspace:*`, which npm cannot install.
FROM oven/bun:1.3.14 AS builder

WORKDIR /build

# The whole workspace, filtered by the root .dockerignore: the lockfile covers
# every workspace, so copying only some of them fails --frozen-lockfile.
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /build/templates/forms-app/services/admin-frontend
RUN bun run build

# ─── Stage 2: Serve with nginx ───────────────────────────────────────────────
FROM nginx:alpine

# The app is built with base /admin/ (assets at /admin/assets/...).
COPY --from=builder /build/templates/forms-app/services/admin-frontend/dist /usr/share/nginx/html/admin

# SPA fallback under /admin/
RUN printf '%s\n' \
    'server {' \
    '    listen 5173;' \
    '    root /usr/share/nginx/html;' \
    '    location /admin/ {' \
    '        try_files $uri $uri/ /admin/index.html;' \
    '    }' \
    '}' > /etc/nginx/conf.d/default.conf

EXPOSE 5173
