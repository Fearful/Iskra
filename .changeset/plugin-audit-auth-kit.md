---
"@iskra-bun/auth-kit": patch
---

**Security:** `createBetterAuth` pins `advanced.disableOriginCheck: false`. Left unset, better-auth skips its Origin check (CSRF on cookie-authenticated requests) and its `callbackURL`/`redirectTo` validation (open redirects) whenever it believes it runs under test: `NODE_ENV=test`, or any `TEST` environment variable other than `"false"` (`TEST=0` included), which a production image can carry from its build.
