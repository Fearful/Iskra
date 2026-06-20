# @iskra-bun/auth-kit

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Transport-agnostic authentication kit extracted from web-kit: the `createBetterAuth` config factory, the Drizzle auth schema (Postgres/MySQL/SQLite), and shared auth types — usable outside the HTTP layer.

### Patch Changes

- Harden auth configuration: `createBetterAuth` now throws if the secret is empty or shorter than 32 characters, instead of silently starting with a weak secret. Generic OAuth providers also default `pkce` to `true` (an explicit `pkce: false` is still honored), so the PKCE protection is on unless deliberately disabled.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
