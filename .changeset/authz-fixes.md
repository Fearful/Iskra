---
"@iskra-bun/web-kit": minor
"@iskra-bun/auth-kit": minor
---

**Security:** authorization fixes.

- `ApiKeyFeature`: an `Authorization: Bearer` token that is not a valid API key no longer returns 401 for every request (it broke JWT/session auth app-wide, public routes included); `requireApiKey()`/`requireScope()` still reject it with the validation error. Cache hits now re-check expiry and ignore keys removed from the config (a Redis cache outlives the restart that rotated them). The `onError`, `onValidated` and `customExtractor` / `"custom"` strategy options are now honored.
- `PermissionsFeature`: role permissions were pushed into the array returned by `loadPermissions()`; a loader returning a shared/cached array leaked them (including admin `"*"`) to other users. The array is now copied.
- `AuthFeature` (**breaking**): email/password login is only enabled in `authMode: "email"` (previously hardcoded on, so OIDC deployments still exposed an open `/sign-up/email`); opt back in with the new `enableEmailPassword` option. `enableSelfRegistration: false` is now honored and disables sign-up.
- `auth-kit`: new `disableSignUp` option for `createBetterAuth`.
