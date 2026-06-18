# Prompt Plan — Phase 6: SDK & Test Polish

> Goal: close the test gaps that make the project look unfinished — SDK tests, template smoke tests — and clarify SDK roadmap. Can partly trail launch.
> Type: `--type feature`.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| TS tests | `bun test` |
| Python SDK | `cd sdks/python/iskra-client && pytest` |
| Java SDK | `cd sdks/java/iskra-client && mvn test` |

## Tasks

- [ ] Task 1: Add unit tests to the **Python SDK** (`sdks/python/iskra-client`) — it declares pytest/pytest-asyncio but has none. Cover the HTTP client, auth/storage/health sub-clients, and the typed exceptions, mocking httpx. Owns: `sdks/python/iskra-client/tests/**`. 
- [ ] Task 2: Add unit tests to the **Java SDK** (`sdks/java/iskra-client`) — add JUnit + a mock HTTP server, cover the client + sub-clients + exception mapping. Add the test deps to `pom.xml`. Owns: `sdks/java/iskra-client/src/test/**`, `pom.xml`. (depends: none)
- [ ] Task 3: Add **smoke tests** for the 5 expanded templates (chat-app, job-worker, cms-starter, desktop-app, universal-app): boot the app and assert it starts / a key endpoint responds. Use `bun test`. Owns: `templates/{chat-app,job-worker,cms-starter,desktop-app,universal-app}/test/**`. (depends: none)
- [ ] Task 4: Java SDK publishability — add `distributionManagement` for Maven Central (or document it as source-only for now) and a release note. Owns: `sdks/java/iskra-client/pom.xml`, `sdks/java/iskra-client/README.md`. (depends: Task 2)
- [ ] Task 5: Document Go and .NET SDKs as **roadmap** (not yet implemented) in `docs/sdks.md` and the docs site; remove any implication they exist. Owns: `docs/sdks.md`. 

## Acceptance

- Python `pytest` and Java `mvn test` both pass in CI.
- 5 template smoke tests pass.
- SDK docs accurately reflect Java/Python = available, Go/.NET = roadmap.
