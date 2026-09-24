---
"@iskra-bun/auth-kit": patch
"@iskra-bun/cache-kit": patch
"@iskra-bun/config-kit": patch
"@iskra-bun/core": patch
"create-iskra": patch
"@iskra-bun/db-kit": patch
"@iskra-bun/db-oracle": patch
"@iskra-bun/desktop-kit": patch
"@iskra-bun/kv-kit": patch
"@iskra-bun/mailer-kit": patch
"@iskra-bun/mobile-kit": patch
"@iskra-bun/process-kit": patch
"@iskra-bun/socket-kit": patch
"@iskra-bun/storage-kit": patch
"@iskra-bun/testing-kit": patch
"@iskra-bun/web-kit": patch
"@iskra-bun/worker-kit": patch
---

Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.
