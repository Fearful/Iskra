---
"create-iskra": patch
---

Scaffolded projects get a standalone `Dockerfile` (and `.dockerignore`). They received the monorepo's, which copies `packages/` and `templates/<name>/` from the repository root, so `docker build` failed in every generated project. The new one installs with the project's lockfile, compiles with `NODE_ENV=production` (Bun inlines it at build time) and runs as a non-root user on UBI9 minimal.
