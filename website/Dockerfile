# Static image for the Iskra docs site.
#
# The site is built in CI (`bun run api && bun run build`) before `fly deploy`,
# producing `website/dist`. This image only serves that output with Caddy.
# If you run `fly deploy` manually, build first:
#   cd website && bun install && bun run api && bun run build
# Pinned (Dependabot bumps it): `2-alpine` changed under every rebuild.
FROM caddy:2.11.4-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY dist /srv

EXPOSE 8080
