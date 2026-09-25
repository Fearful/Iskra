---
"@iskra-bun/core": minor
---

**Breaking (types):** no more `any` in core's public API.

- `app.context` is an `AppContext` (a `Map`) typed through the `AppContextRegistry` interface: kits register their keys (`db`, `kv`, `oracle`), apps add theirs with declaration merging, and an unregistered key holds `unknown` (or the type given as `get<T>()`).
- `app.on()` / `app.emit()` are typed through the `AppEvents` interface (kits declare their events); other events' payloads are `unknown`. `Context<T>` defaults to `unknown` and `reply()` takes `unknown`.
- `AppConfig`'s extra sections are `unknown` (were `any`); `kv.connection` is `string | Record<string, unknown>`.
- The optional OpenTelemetry modules are loaded through small typed interfaces; `createResource()` takes an `OtelResourcesModule` and returns `unknown`.

See the "Upgrading to the typed APIs" guide.
