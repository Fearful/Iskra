---
"@iskra-bun/core": minor
---

`traced(name, fn)` wraps a function in an OpenTelemetry span named by its layer, domain and method (`repo.usuarios.buscar`): active while it runs, so spans started inside are its children, and marked as an error on a throw or a rejection. `@opentelemetry/api` is now a dependency (without an SDK the spans are no-ops).
