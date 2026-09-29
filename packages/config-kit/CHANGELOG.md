# @iskra-bun/config-kit

## 0.2.0

### Minor Changes

- e5f41e7: `fromEnv(spec)` builds a kit's section of `app.config` from environment variables with names of your own, such as a legacy service's: each field names its variable, or several (the first one set wins), with `env(names, parser, { default | optional })` converting it by any coercer (`envNumber`, `envPort`…) or Zod schema of a string. Nested sections work, the result is typed from the spec, and every problem is reported at once in a `ConfigError` that names the variables, never their values.

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.1.1

### Patch Changes

- 5c70c5b: Validation errors no longer quote the value received, which could be a secret put in the wrong variable: neither the `env*` coercers nor Zod's enum and literal messages include it.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- Updated dependencies [620da18]
- Updated dependencies [b635a2c]
- Updated dependencies [5b2b0fd]
- Updated dependencies [58d4a8f]
- Updated dependencies [5c70c5b]
- Updated dependencies [ec198d4]
- Updated dependencies [cb3ec43]
- Updated dependencies [ef2009b]
- Updated dependencies [840439a]
- Updated dependencies [dbf8817]
- Updated dependencies [3dc5581]
- Updated dependencies [9872d30]
- Updated dependencies [f2346f5]
- Updated dependencies [3579944]
    - @iskra-bun/core@0.2.0

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Typed, Zod-validated environment/config loading: `loadConfig` returns a deep-frozen config, env coercers (`envBool`, `envNumber`, `envPort`, `envEnum`), and validation errors that never echo secret values.

### Patch Changes

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
