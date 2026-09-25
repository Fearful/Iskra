---
"@iskra-bun/auth-kit": minor
---

**Breaking (types):** `User` and `SignUpInput` custom fields are `unknown` (were `any`), and `socialProviders` takes better-auth's own option type. The OIDC profile mapping (`mapOidcProfile`, now exported and tested) returns only local user fields: the `id` it returned was ignored by better-auth, which takes the account's identity from the verified `sub`.
