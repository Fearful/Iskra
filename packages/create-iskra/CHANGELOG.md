# create-iskra

## 0.1.1

### Patch Changes

- f2346f5: The bundled templates' `bun dev` script sets `NODE_ENV=development`, since Iskra now applies its production defaults when `NODE_ENV` is unset. `starter-app` gains a `dev` script.
- 5c70c5b: `npm create iskra`, `npx create-iskra` and `bunx create-iskra` work: run through the `node_modules/.bin` link, the CLI compared the link's path with its own and did nothing. Ctrl-C at a prompt cancels instead of scaffolding with the defaults. The generated project gets a `.gitignore` (npm leaves them out of the package) and a valid package name for targets such as `my-app/` or `.`. The templates read `PORT` and exit with code 1 when the app fails to start. `src` is published, as the `bun` export condition points at it.
- b77f359: Scaffolded projects get a standalone `Dockerfile` (and `.dockerignore`). They received the monorepo's, which copies `packages/` and `templates/<name>/` from the repository root, so `docker build` failed in every generated project. The new one installs with the project's lockfile, compiles with `NODE_ENV=production` (Bun inlines it at build time) and runs as a non-root user on UBI9 minimal.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- 9bb254d: **Security** fixes from the plugin audit.

    - `kv-kit`: Redis errors passed to `onError` (and so logged by `KVManager`) and the cause of a failed `connect()` keep only the command's name. ioredis attached its arguments, so a refused login logged the Redis password (`command.args` of AUTH), for example after a password rotation.
    - `socket-kit`: `ctx.broadcast()` and `ctx.join()` refuse a room or topic that is not a string before calling `canPublish`/`canJoin`. A handler passing the client's value on could be given `["global"]`, which passes a deny-list such as `topic !== 'global'` and which Bun's `publish()` turns into `"global"`. The rate limiter logs one warning per connection and window instead of one per dropped frame (a flooding client wrote ~23 bytes of log per byte sent), and a frame that is not JSON is logged at debug level without a stack.
    - `process-kit` (**breaking**): `send()` refuses a string with a line break, which the child read as several messages (send an object to have it JSON-encoded). After a stdout line longer than 1 MiB, the rest of that line is dropped instead of being read as a line of its own, which let text a child echoed come out as a JSON `process:message`. The spawn log line has the command and the number of arguments; the arguments, which can carry credentials, are logged at debug level.
    - `create-iskra`: `scaffold()` only accepts the name of a bundled template (`../x` copied any directory into the new project), and `scripts/sync.ts` refuses symlinks in a template instead of copying their target into the published package.

- 537cbf0: The `starter-app` template ships with `debug: false` and info-level logging (it logged at debug level), caps the user name at 100 characters and the in-memory user store at 1000 users (`POST /users` answers 507 when full), and comes with a test. The Dockerfiles of both templates copy the compiled binary root-owned and read-only (`--chmod=0555`): with `--chown=1001:0` the user the app runs as could overwrite it, so a compromise of the app could persist. The runtime image is pinned to `ubi9/ubi-minimal:9.8` instead of `:latest`.

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Project scaffolding CLI — `bun create iskra <dir>` — with zero runtime dependencies and bundled starter templates.
