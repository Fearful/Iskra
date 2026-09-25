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

## Test coverage 🟢

- **SDK tests** — the Python and Java SDKs run against the real contract
  server (`sdks/contract/server.ts`) in CI, and the Spring MVC example is built.
- **Template smoke tests** — every template with a Dockerfile is built, started
  and probed over HTTP (`bun run smoke:templates`, forms-app through its
  docker compose); desktop-app and universal-app have boot tests.

## SDKs ⚪

- **Java SDK** — publishability to Maven Central (`distributionManagement`).
- **Go and .NET SDKs** — not yet implemented; planned. The TypeScript, Python,
  and Java clients are the currently available SDKs.

## Have an idea?

Open an issue or a discussion. Good first contributions are labelled
`good first issue` once the repo is public.
