---
"@iskra-bun/web-kit": minor
---

**Breaking:** no more `any` in web-kit's public API, and validation is a typed middleware.

- `ValidationFeature` and `JsonSchemaValidationFeature` are removed, with the untyped `app.*Validated()` methods and `c.valid()` they added. Use the `validate()` (Zod v3 or v4) and `validateJson()` (JSON Schema) middlewares: the handler reads typed data from `c.get("validated")`. `createValidationMiddleware` / `createJsonSchemaValidationMiddleware` are renamed `validate` / `validateJson`.
- WebDriver: `RouteOptions` / `WebContext` default to `unknown`; `defineRoute()` infers a route's body and query types from its schema.
- Sessions: `c.get("session")` is a `SessionData` (fields `unknown` until declared with declaration merging). The DB session store runs typed per-dialect queries.
- Config callbacks (`authorize`, `keyGenerator`, `skip`, `handler`, `customExtractor`, `onError`, `onValidated`, health `checks`, error handler `customHandlers`/`logger`) receive Hono's `Context`. `CacheAdapter.get()` returns `unknown`. `c.get("logger")` is a `RequestLogger`. `OtelTracingConfig` is `@hono/otel`'s options with `serviceName` required. `ApiKeyConfig.vaultService` (never used) is removed.
- Internal: DbFeature keeps its client per dialect (typed ping and shutdown); CORS builds Hono's options without casts; cached permissions are validated before use.

See the "Upgrading to the typed APIs" guide.
