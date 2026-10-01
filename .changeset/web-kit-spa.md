---
"@iskra-bun/web-kit": minor
---

`SpaFeature` serves a built client app (Vite's `dist/`) from the same process: its files, and the entry page for every other path the client routes. It answers only what no route takes, through the new `Kernel.setFallback()`, and never under `exclude` (`/api` by default, plus `AuthFeature`'s `basePath` and the health paths), where an unknown path stays a JSON 404. Hashed assets (`assetsDir`) are `immutable` for a year and a missing one is a 404, not the page; the entry page and the other files are `no-cache` with an ETag. `config` is put in the page as `window.__APP_CONFIG__` when the server starts, escaped so a value cannot close the script, and `contentSecurityPolicy(hash)` gets the script's hash for a strict CSP. Only the regular files listed under `root` at startup are served (no traversal, dotfiles or symlinks); without the entry page it refuses to start in production. `AuthFeature` exposes its `basePath`.
