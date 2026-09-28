---
"@iskra-bun/core": minor
"@iskra-bun/auth-kit": minor
"@iskra-bun/web-kit": minor
---

**Breaking behavior:** production safeguards now apply unless `NODE_ENV` is `development` or `test`. They applied only to `NODE_ENV=production` exactly, so a deploy that forgot it (or used `staging`) sent session cookies without `Secure`, accepted sample secrets and plain-http auth URLs, honored `disableCSRFCheck` and wrote pretty logs. `NODE_ENV` is also read when the app runs: `bun build` replaced a literal `process.env.NODE_ENV` with `"development"` when it was unset while building, so a compiled binary ignored the value it ran with. `app.start()` logs a warning when `NODE_ENV` is unset. Set `NODE_ENV=development` for local development; the templates' `bun dev` scripts do. New `nodeEnv()`, `isProductionEnv()` and `isDevelopmentEnv()` in `@iskra-bun/core`.
