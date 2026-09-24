# @iskra-bun/web-kit

## 0.2.0

### Minor Changes

- **Breaking:** public class renames for naming consistency with the `Driver`/`Feature` conventions:

    - `WebServer` → `WebDriver` (same `{ port, routes }` options).
    - `HealthFeature` → `HealthCheckFeature`.

    Update imports accordingly: `import { WebDriver } from '@iskra-bun/web-kit'`. See the "Upgrading to 0.2" guide for the full migration. (Pre-1.0, but bumped as a minor to signal the break.)

### Patch Changes

- f9654df: `DbDriver` and `DbFeature` now accept an optional schema generic (`DbDriver<TSchema>` / `DbFeature<TSchema>`), so `.db` is a typed Drizzle database instead of `any` — opt-in callers get typed relational queries and autocomplete. The generic defaults preserve existing behavior, so no call site needs changes; consumers that relied on `any` may need to add a type argument or annotation.
- f9654df: Internal refactor: the email, storage, and auth features now delegate to the new standalone `@iskra-bun/mailer-kit`, `@iskra-bun/storage-kit`, and `@iskra-bun/auth-kit` packages instead of bundling their own copies. The public API (`EmailFeature`, `StorageFeature`, `AuthFeature`, and the types/adapters they re-export) is unchanged. The now-transitive `nodemailer`, `@sendgrid/mail`, and `@aws-sdk/*` direct dependencies were dropped. Note: `MockEmailAdapter` no longer prints a `console.log` line on send (it is now silent).
- Security fixes for the web server:

    - The health endpoint no longer leaks internal details by default: `includeDetails` defaults to `false`, failing feature/custom/db checks return only `{ status: 'error' }`, and the raw error is logged server-side only instead of being returned in the response.
    - API keys are no longer used verbatim as cache keys — the cache key is now a SHA-256 hash of the key, so raw secrets are kept out of the cache layer.
    - The CSRF kill-switch (`disableCSRFCheck`) is ignored in production: it is only forwarded when `NODE_ENV !== 'production'`, so CSRF protection cannot be accidentally disabled in a production deployment.

- f9654df: Security and correctness fixes:

    - API key ids are now random and no longer expose a prefix of the secret key.
    - CSRF tokens are HMAC-signed (signed double-submit cookie) and compared in constant time; forged, tampered, and unsigned tokens are rejected.
    - `/health/ready` now runs readiness checks registered via `addReadinessCheck()` and returns 503 when any fails, instead of always reporting ready.

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies
- Updated dependencies [f9654df]
- Updated dependencies [f9654df]
- Updated dependencies [f9654df]
- Updated dependencies
    - @iskra-bun/auth-kit@0.1.0
    - @iskra-bun/core@0.1.1
    - @iskra-bun/mailer-kit@0.1.0
    - @iskra-bun/storage-kit@0.1.0

## 0.1.0

### Minor Changes

- Initial public release.
