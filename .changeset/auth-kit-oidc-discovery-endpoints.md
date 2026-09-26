---
"@iskra-bun/auth-kit": patch
"@iskra-bun/web-kit": patch
---

`oidcConfig` endpoints that are not set now come from the issuer's discovery document. They defaulted to Keycloak's `${issuer}/protocol/openid-connect/{auth,token,userinfo}` paths, and better-auth only fills the endpoints left unset from discovery, so every other provider (Auth0, Okta, Entra ID, …) got URLs that do not exist and sign-in failed unless all three were configured by hand. `authorizationEndpoint`, `tokenEndpoint` and `userinfoEndpoint` still override the discovered ones. The provider config is built by the new exported `oidcProviderConfig(oidcConfig)`; web-kit's `AuthFeature` passes its `oidcConfig` through, so it gets the same behaviour. With only the `issuer` set, the provider now depends on discovery at startup: if the discovery document cannot be fetched then (for example the IdP container starts after the app), better-auth logs the error and leaves the provider out until the app restarts. Set the three endpoints explicitly to avoid that dependency.
