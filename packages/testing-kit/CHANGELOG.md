# @iskra-bun/testing-kit

## 0.1.1

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- e873733: `createMockLogger()` reports every level as enabled: `isLevelEnabled()` returns `true` and `level` is `'trace'` (they were `false` and `'error'`), so code that guards a log call with `isLevelEnabled()` reaches the capture arrays.
- 5c70c5b: `createTestServer()` keeps headers passed as a `Headers` instance or as tuples along with a JSON body (they were lost or broke the request), and a caller's `Content-Type` in any case replaces the JSON default instead of being sent next to it.
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

- f9654df: Initial public release. Test utilities for Iskra apps: `createTestApp`, `createMockLogger`, `createMockDriver`, `withTempDir`, and `createTestServer`.

### Patch Changes

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
