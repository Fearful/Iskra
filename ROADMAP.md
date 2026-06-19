# Roadmap

Iskra is at **v0.1.0**. The core framework and kits are usable today; the items
below are planned but not yet shipped. Contributions are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

> Status legend: 🟢 stable · 🟡 experimental · ⚪ planned / not started

## Stabilizing the experimental kits 🟡

`@iskra-bun/desktop-kit`, `@iskra-bun/mobile-kit`, and `@iskra-bun/db-oracle`
ship as **experimental** (`0.x`, breaking changes allowed in minor releases).
The goal is to harden their APIs and graduate them to stable. See
[VERSIONING.md](VERSIONING.md).

## Test coverage ⚪

- **SDK unit tests** — the Python (`sdks/python/iskra-client`) and Java
  (`sdks/java/iskra-client`) SDKs need unit test suites (mocked HTTP) wired into
  CI.
- **Template smoke tests** — boot-and-probe tests for the larger templates
  (chat-app, job-worker, cms-starter, desktop-app, universal-app) so a broken
  template is caught in CI.

## SDKs ⚪

- **Java SDK** — publishability to Maven Central (`distributionManagement`).
- **Go and .NET SDKs** — not yet implemented; planned. The TypeScript, Python,
  and Java clients are the currently available SDKs.

## Have an idea?

Open an issue or a discussion. Good first contributions are labelled
`good first issue` once the repo is public.
