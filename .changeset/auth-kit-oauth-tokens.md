---
"@iskra-bun/auth-kit": minor
"@iskra-bun/web-kit": minor
---

OAuth tokens are stored encrypted, and renewed when they are about to expire. `createBetterAuth` always turns on better-auth's `encryptOAuthTokens`: the access and refresh tokens of social and OIDC accounts are stored AES-256-GCM encrypted with a key derived from `secret`, so changing the secret makes them unreadable (their users sign in again). **Breaking (0.x):** tokens stored in plain text by an earlier version may no longer be read; have those users sign in again, or clear `accessToken` and `refreshToken` in the `account` table.

`getProviderAccessToken(auth, { providerId, headers | userId, accountId?, minValidityMs? })` hands out a valid access token for the user's account with a provider, renewing it with the refresh token when it expires within `minValidityMs` (60 s). Renewals of one account run one at a time and re-read the account first, since providers that rotate refresh tokens (GitLab) accept each one once; with `headers` the session is read from the database, so a revoked session cannot get tokens. It throws `OAuthTokenError` with a `code`: a 4xx from the provider is `REFRESH_FAILED`, while a network error or 5xx is `PROVIDER_UNAVAILABLE` and keeps the stored pair, so an outage does not sign everyone out. In web-kit, `getAccessToken(c, providerId)` answers them with 401 `UNAUTHORIZED` (no session), 401 `OAUTH_REAUTH_REQUIRED` (sign in with the provider again) or 502 `OAUTH_PROVIDER_UNAVAILABLE`. better-auth is raised to `^1.7.5`.
