---
"@iskra-bun/web-kit": patch
---

Security and correctness fixes:

- API key ids are now random and no longer expose a prefix of the secret key.
- CSRF tokens are HMAC-signed (signed double-submit cookie) and compared in constant time; forged, tampered, and unsigned tokens are rejected.
- `/health/ready` now runs readiness checks registered via `addReadinessCheck()` and returns 503 when any fails, instead of always reporting ready.
