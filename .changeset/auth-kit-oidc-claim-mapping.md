---
"@iskra-bun/auth-kit": patch
"@iskra-bun/web-kit": patch
---

`oidcConfig.mapping` is now applied: `email`, `name`, `image` and `emailVerified` name the claims the user's fields are read from, falling back to the standard claims when the profile lacks them (a mapped `emailVerified` claim counts as verified when it is `true` or `"true"`). A mapped email is verified only by its paired mapped flag, or by the standard `email_verified` when it is the same address, so a verified standard email never vouches for a different mapped one (better-auth links verified emails to existing local users). It was accepted but never read, so a provider with non-standard claim names created users without them. `mapOidcProfile(profile, mapping?)` takes the mapping as an optional second argument. `jwksEndpoint`, `mapping.id` and `mapping.extraFields` are marked `@deprecated` and still ignored: better-auth takes the JWKS only from the discovery document's `jwks_uri`, the account's identity always comes from the verified `sub`, and extra user fields need better-auth `user.additionalFields`.
