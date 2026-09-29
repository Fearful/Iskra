---
"@iskra-bun/web-kit": minor
---

Auth gates prove who made a request and combine: `bearer(verify)`, `jwt({ secret | jwksUri, issuer, audience })` (Hono's JWT utilities, no new dependency), `apiKey(store)` with `staticKeys([...])` or `hashedKeys(lookup)` for keys a database stores as `hashApiKey(key)`, `session()` for AuthFeature's user, `anyOf(...)` and `allOf(...)`. `requireActor(gate)` puts the actor in `c.var.actor`, typed as the gates' (or the app's, declared once in `ActorRegistry`), and answers 401 with a `WWW-Authenticate` challenge by the response contract; `identify(gate)` sets it when present; `requireScopes(...)` answers 403 without the scopes. They need neither AuthFeature nor a database of their own, so a service with its own identity provider and API keys in a table no longer writes them by hand. `ApiKeyFeature` takes a `store` too, looked up after its `staticKeys`, and every `HttpError` subclass takes `headers`.
