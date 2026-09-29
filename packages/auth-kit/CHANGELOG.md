# @iskra-bun/auth-kit

## 0.2.1

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.2.0

### Minor Changes

- 76028ab: **Breaking (0.x):** `createBetterAuth` no longer defaults `baseURL` to `http://localhost:3000` everywhere. It now reads `BETTER_AUTH_URL` when `baseURL` is not passed (the hardcoded default overrode better-auth's own fallback to it), keeps the localhost default only outside production, and with `NODE_ENV=production` throws when neither is set or when the origin is plain `http://` on a host other than `localhost`, `127.0.0.1` or `[::1]`. better-auth marks the session cookies `Secure` only for an https `baseURL` and trusts that origin, so a production app built without one sent its session cookies over plain HTTP and trusted `http://localhost:3000`. Pass `baseURL: 'https://your-app.example.com'` (or set `BETTER_AUTH_URL`) in production. The rule is exported as `resolveAuthBaseURL(baseURL?, who?)`, which web-kit's `AuthFeature` now uses (its behaviour is unchanged).
- 7720bd5: New `rateLimit: false` and `ipAddressHeaders` options for better-auth's rate limiter and client IP. The MySQL `verification.value` column is `text` (OAuth state is longer than 255 characters, so OIDC sign-in failed in strict mode); existing tables need `ALTER TABLE verification MODIFY value TEXT NOT NULL`.
- cb3ec43: **Breaking (types):** `User` and `SignUpInput` custom fields are `unknown` (were `any`), and `socialProviders` takes better-auth's own option type. The OIDC profile mapping (`mapOidcProfile`, now exported and tested) returns only local user fields: the `id` it returned was ignored by better-auth, which takes the account's identity from the verified `sub`.
- 0f1ce5b: **Security:** authorization fixes.

    - `ApiKeyFeature`: an `Authorization: Bearer` token that is not a valid API key no longer returns 401 for every request (it broke JWT/session auth app-wide, public routes included); `requireApiKey()`/`requireScope()` still reject it with the validation error. Cache hits now re-check expiry and ignore keys removed from the config (a Redis cache outlives the restart that rotated them). The `onError`, `onValidated` and `customExtractor` / `"custom"` strategy options are now honored.
    - `PermissionsFeature`: role permissions were pushed into the array returned by `loadPermissions()`; a loader returning a shared/cached array leaked them (including admin `"*"`) to other users. The array is now copied.
    - `AuthFeature` (**breaking**): email/password login is only enabled in `authMode: "email"` (previously hardcoded on, so OIDC deployments still exposed an open `/sign-up/email`); opt back in with the new `enableEmailPassword` option. `enableSelfRegistration: false` is now honored and disables sign-up.
    - `auth-kit`: new `disableSignUp` option for `createBetterAuth`.

- ef2009b: **Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

    - `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
    - `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
    - `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
    - `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).

- f2346f5: **Breaking behavior:** production safeguards now apply unless `NODE_ENV` is `development` or `test`. They applied only to `NODE_ENV=production` exactly, so a deploy that forgot it (or used `staging`) sent session cookies without `Secure`, accepted sample secrets and plain-http auth URLs, honored `disableCSRFCheck` and wrote pretty logs. `NODE_ENV` is also read when the app runs: `bun build` replaced a literal `process.env.NODE_ENV` with `"development"` when it was unset while building, so a compiled binary ignored the value it ran with. `app.start()` logs a warning when `NODE_ENV` is unset. Set `NODE_ENV=development` for local development; the templates' `bun dev` scripts do. New `nodeEnv()`, `isProductionEnv()` and `isDevelopmentEnv()` in `@iskra-bun/core`.
- c24201a: **Security (breaking):** with `NODE_ENV=production`, `createBetterAuth` refuses a secret that is still a sample value: one containing `change-me`, `dev-secret`, `dev-only`, `your-secret` or `placeholder`, compared without case, `-`, `_`, `.` or spaces (so `changeme` and `CHANGE_ME` count too). A sample secret copied from docs or an `.env.example` is public, and it signs better-auth's session cookie cache, which is trusted without a database lookup: anyone could forge a session for any user. The error names the matching word, never the secret.

### Patch Changes

- d6151cb: `oidcConfig.mapping` is now applied: `email`, `name`, `image` and `emailVerified` name the claims the user's fields are read from, falling back to the standard claims when the profile lacks them (a mapped `emailVerified` claim counts as verified when it is `true` or `"true"`). A mapped email is verified only by its paired mapped flag, or by the standard `email_verified` when it is the same address, so a verified standard email never vouches for a different mapped one (better-auth links verified emails to existing local users). It was accepted but never read, so a provider with non-standard claim names created users without them. `mapOidcProfile(profile, mapping?)` takes the mapping as an optional second argument. `jwksEndpoint`, `mapping.id` and `mapping.extraFields` are marked `@deprecated` and still ignored: better-auth takes the JWKS only from the discovery document's `jwks_uri`, the account's identity always comes from the verified `sub`, and extra user fields need better-auth `user.additionalFields`.
- 093656f: `oidcConfig` endpoints that are not set now come from the issuer's discovery document. They defaulted to Keycloak's `${issuer}/protocol/openid-connect/{auth,token,userinfo}` paths, and better-auth only fills the endpoints left unset from discovery, so every other provider (Auth0, Okta, Entra ID, …) got URLs that do not exist and sign-in failed unless all three were configured by hand. `authorizationEndpoint`, `tokenEndpoint` and `userinfoEndpoint` still override the discovered ones. The provider config is built by the new exported `oidcProviderConfig(oidcConfig)`; web-kit's `AuthFeature` passes its `oidcConfig` through, so it gets the same behaviour. With only the `issuer` set, the provider now depends on discovery at startup: if the discovery document cannot be fetched then (for example the IdP container starts after the app), better-auth logs the error and leaves the provider out until the app restarts. Set the three endpoints explicitly to avoid that dependency.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- 8f31aa5: **Security:** `createBetterAuth` pins `advanced.disableOriginCheck: false`. Left unset, better-auth skips its Origin check (CSRF on cookie-authenticated requests) and its `callbackURL`/`redirectTo` validation (open redirects) whenever it believes it runs under test: `NODE_ENV=test`, or any `TEST` environment variable other than `"false"` (`TEST=0` included), which a production image can carry from its build.
- Updated dependencies [620da18]
- Updated dependencies [b635a2c]
- Updated dependencies [5b2b0fd]
- Updated dependencies [58d4a8f]
- Updated dependencies [5c70c5b]
- Updated dependencies [ec198d4]
- Updated dependencies [cb3ec43]
- Updated dependencies [ef2009b]
- Updated dependencies [840439a]
- Updated dependencies [dbf8817]
- Updated dependencies [3dc5581]
- Updated dependencies [9872d30]
- Updated dependencies [f2346f5]
- Updated dependencies [3579944]
    - @iskra-bun/core@0.2.0

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Transport-agnostic authentication kit extracted from web-kit: the `createBetterAuth` config factory, the Drizzle auth schema (Postgres/MySQL/SQLite), and shared auth types — usable outside the HTTP layer.

### Patch Changes

- Harden auth configuration: `createBetterAuth` now throws if the secret is empty or shorter than 32 characters, instead of silently starting with a weak secret. Generic OAuth providers also default `pkce` to `true` (an explicit `pkce: false` is still honored), so the PKCE protection is on unless deliberately disabled.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
