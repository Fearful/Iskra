---
"@iskra-bun/process-kit": minor
"@iskra-bun/core": minor
---

**Security:** runtime hardening from the second audit round.

- `process-kit` (**breaking**): a child no longer inherits the app's whole environment. It gets the variables programs need and that carry no secrets (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, the locale, `TZ`, the temp dir, `NODE_ENV`, and the Windows essentials), plus `env`: `DATABASE_URL`, `AUTH_SECRET`, cloud keys and whatever was loaded from `.env` reached every child, third-party code included. The new `inheritEnv` option (validated by the core config schema, as is `maxPendingStdinBytes`) takes more names to pass, or `true` for all of them as before.
- `process-kit`: `send()` refuses a message, with one warning until the child catches up, when the bytes still waiting for a child that is not reading its stdin would go over `maxPendingStdinBytes` (8 MiB by default). They piled up in the app's memory without a bound: 256 MiB sent to such a child grew RSS by 263 MiB. `send()` now resolves to whether the message was sent (`false` for every refusal).
