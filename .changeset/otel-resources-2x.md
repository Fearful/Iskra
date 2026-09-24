---
"@iskra-bun/core": patch
---

Fix: `initOtel()` failed with "undefined is not a constructor" on current OpenTelemetry releases. `@opentelemetry/resources` 2.x only exports `resourceFromAttributes()` (the `Resource` class became a type), and the peer range (`>=1.20.0`) allowed it. The resource is now built with whichever API is installed (new `createResource` helper), verified end to end with `@opentelemetry/sdk-node` 0.222 / resources 2.11 exporting a span to an OTLP endpoint; 1.x keeps working.
