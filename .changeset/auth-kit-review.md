---
"@iskra-bun/auth-kit": minor
---

New `rateLimit: false` and `ipAddressHeaders` options for better-auth's rate limiter and client IP. The MySQL `verification.value` column is `text` (OAuth state is longer than 255 characters, so OIDC sign-in failed in strict mode); existing tables need `ALTER TABLE verification MODIFY value TEXT NOT NULL`.
