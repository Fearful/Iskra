---
"@iskra-bun/auth-kit": minor
---

**Breaking (0.x):** `createBetterAuth` no longer defaults `baseURL` to `http://localhost:3000` everywhere. It now reads `BETTER_AUTH_URL` when `baseURL` is not passed (the hardcoded default overrode better-auth's own fallback to it), keeps the localhost default only outside production, and with `NODE_ENV=production` throws when neither is set or when the origin is plain `http://` on a host other than `localhost`, `127.0.0.1` or `[::1]`. better-auth marks the session cookies `Secure` only for an https `baseURL` and trusts that origin, so a production app built without one sent its session cookies over plain HTTP and trusted `http://localhost:3000`. Pass `baseURL: 'https://your-app.example.com'` (or set `BETTER_AUTH_URL`) in production. The rule is exported as `resolveAuthBaseURL(baseURL?, who?)`, which web-kit's `AuthFeature` now uses (its behaviour is unchanged).
