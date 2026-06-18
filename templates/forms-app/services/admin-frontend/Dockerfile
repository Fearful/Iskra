# ─── Admin Frontend ───────────────────────────────────────────────────────────
# Build: docker build -f services/admin-frontend/Dockerfile .
# Context: templates/forms-app/

# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build
COPY services/admin-frontend/package.json services/admin-frontend/
COPY packages/shared/package.json packages/shared/

RUN cd services/admin-frontend && npm install

COPY packages/shared/ packages/shared/
COPY services/admin-frontend/ services/admin-frontend/

RUN cd services/admin-frontend && npm run build

# ─── Stage 2: Serve with nginx ───────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /build/services/admin-frontend/dist /usr/share/nginx/html

# SPA fallback
RUN echo 'server { \
    listen 5173; \
    root /usr/share/nginx/html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 5173
