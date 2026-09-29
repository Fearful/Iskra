---
"@iskra-bun/config-kit": minor
---

`fromEnv(spec)` builds a kit's section of `app.config` from environment variables with names of your own, such as a legacy service's: each field names its variable, or several (the first one set wins), with `env(names, parser, { default | optional })` converting it by any coercer (`envNumber`, `envPort`…) or Zod schema of a string. Nested sections work, the result is typed from the spec, and every problem is reported at once in a `ConfigError` that names the variables, never their values.
