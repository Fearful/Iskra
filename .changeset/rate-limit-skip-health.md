---
"@iskra-bun/web-kit": minor
---

`RateLimitFeature` no longer counts the health feature's routes (`/health`, `/health/ready`, `/health/live`, or the paths it is configured with): a kubelet probing every 10 seconds from the node's IP went over the default 100 requests per 15 minutes, got 429 on `/health/live` and restarted the pod. `skipHealthChecks: false` counts them again. The limiter also logs a warning once when requests carry `X-Forwarded-For` / `X-Real-IP` but the Kernel has no `trustProxy`, since behind a proxy every client then shares the proxy's bucket. `HealthCheckFeature#paths` lists its routes.
