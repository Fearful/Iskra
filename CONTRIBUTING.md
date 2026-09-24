# Contributing to Iskra

Thanks for your interest in contributing to Iskra! This document explains how to
set up your environment, the checks your changes must pass, and the workflow for
getting a pull request merged.

By participating in this project you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- **[Bun](https://bun.sh)** — the runtime, package manager, and test runner for
  this monorepo. The version is pinned in [`.bun-version`](./.bun-version); please
  match it. Check your installed version with:

  ```bash
  bun --version
  # e.g. 1.1.x
  ```

  If your version is older than the pinned one, upgrade with `bun upgrade`.
- **[Node.js](https://nodejs.org)** v18+ — required by some native dependencies.
- **[Redis](https://redis.io)** — only needed if you work on `worker-kit` or
  `kv-kit` with the Redis adapter.

## Getting started

```bash
git clone https://github.com/fearful/iskra.git
cd iskra
bun install
```

## Verifying your changes

Iskra's `main` branch is kept green. Before opening a pull request, run all three
checks locally and make sure they pass:

```bash
bun test          # all tests must pass
bun run lint      # ESLint — 0 errors
bun run typecheck # tsc --noEmit — 0 errors
```

`bun run ci` runs all of them plus `bun run build` (the tsup/`.d.ts` build that
only runs at release time), in the same order as the CI pipeline.

If you only touched one package you can scope `bun test` to it (for example
`bun test packages/core`), but the full suite must still pass before you submit.

### Dependency audit

With Bun >= 1.2 installed alongside, `bun audit` lists known vulnerabilities in
the resolved tree. Security fixes in transitive dependencies are pinned with
`overrides` in the root `package.json`; accepted findings (with a reason and
expiry) live in `osv-scanner.toml`, which the CI audit job reads.

### Integration tests

The Redis, PostgreSQL and MySQL integration suites are skipped unless their
service is reachable. To run them locally, start the services with the same
credentials CI uses and export the URLs before `bun test`:

```bash
docker run -d --name iskra-redis -p 6379:6379 redis:7
docker run -d --name iskra-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
docker run -d --name iskra-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=mysql -e MYSQL_DATABASE=test mysql:8

export TEST_REDIS_URL=redis://127.0.0.1:6379
export TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
export TEST_MYSQL_URL=mysql://root:mysql@127.0.0.1:3306/test
bun run ci
```

### SDK contract tests

The Python and Java SDKs are tested against a real Iskra service:
`sdks/contract/server.ts` (auth on in-memory SQLite, health, uploads, typical
success/error responses). `bun test` only checks that it boots; the SDK suites
start it themselves and need `bun` on `PATH` (or `BUN=/path/to/bun`):

```bash
# Python (3.9+)
cd sdks/python/iskra-client
python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest                                   # or `bun run test:sdk:python` from the root

# Java (JDK 11+, Maven)
cd sdks/java/iskra-client
mvn test                                 # or `bun run test:sdk:java` from the root

# Run the server by hand (prints ISKRA_CONTRACT_READY {"port":...,"baseUrl":...})
bun run contract:server
```

Changing a response shape of web-kit or auth-kit? Run these suites too.

## Project layout

The repository is a Bun workspace monorepo:

| Directory     | What lives here |
| :------------ | :-------------- |
| `packages/`   | The kits — the framework's modular building blocks (`@iskra-bun/core`, `@iskra-bun/web-kit`, `@iskra-bun/db-kit`, etc.). |
| `templates/`  | Ready-to-use example apps that show how the kits fit together (e.g. `simple-server`, `chat-app`, `full-stack-app`). |
| `sdks/`       | Client SDKs for other languages (`java`, `python`) that integrate with Iskra over HTTP. |
| `docs/`       | Architecture and per-kit documentation. |

> **Experimental kits:** `desktop-kit`, `mobile-kit`, and `db-oracle` are
> experimental. Their APIs may change without notice — contributions are welcome,
> but expect rougher edges than the stable kits.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to track changes and
generate changelogs. When your change affects a published package, add a changeset:

```bash
bunx changeset
```

Follow the prompts to select the affected packages and the semver bump (patch /
minor / major), then commit the generated file alongside your changes. Merging to
`main` opens a "Version Packages" PR; merging that PR publishes to npm. See
[VERSIONING.md](VERSIONING.md) for the full policy (including the experimental-kit
rules).

## Commit messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <description>
```

Allowed types:

| Type       | Use for |
| :--------- | :------ |
| `feat`     | A new feature |
| `fix`      | A bug fix |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `docs`     | Documentation only |
| `test`     | Adding or fixing tests |
| `chore`    | Tooling, dependencies, or housekeeping |
| `perf`     | A performance improvement |
| `ci`       | CI configuration changes |

Example: `feat: add retry backoff to worker-kit job handler`.

## Pull request flow

1. **Branch from `main`.** Create a topic branch for your change.
2. **Make your change** and keep it focused — one logical change per PR.
3. **Run the verification checks** above (`bun test`, `bun run lint`,
   `bun run typecheck`).
4. **Add a changeset** if a published package is affected.
5. **Open a pull request** against `main` on
   [github.com/fearful/iskra](https://github.com/fearful/iskra), describing what
   changed and why.
6. **CI must pass.** A maintainer will review once the pipeline is green.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](./SECURITY.md) for how to report them privately.

## License

Iskra is licensed under **AGPL-3.0-or-later**. By contributing, you agree that
your contributions will be licensed under the same terms.
