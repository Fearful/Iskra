---
"@iskra-bun/config-kit": patch
---

Validation errors no longer quote the value received, which could be a secret put in the wrong variable: neither the `env*` coercers nor Zod's enum and literal messages include it.
