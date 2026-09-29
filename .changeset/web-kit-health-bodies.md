---
"@iskra-bun/web-kit": minor
---

`HealthCheckFeature` takes a `body` per endpoint (`health`, `ready`, `live`) that builds the response from a `HealthReport` (`endpoint`, `ok`, `checks`, `failed`, `timestamp`, `uptime`), so a service can keep the body its probes already expect (`{ message: 'ok' }`); the status code is still 200 or 503, unless the function returns a `Response`. `path`, `readinessPath` and `livenessPath` accept `false` to leave an endpoint out, and the rate limiter only skips the endpoints served.
