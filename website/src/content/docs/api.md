---
title: API Reference
description: Auto-generated TypeDoc API reference for every Iskra package.
---

The full API reference is generated from the TypeScript source of every package with [TypeDoc](https://typedoc.org).

👉 **[Open the generated API reference](/api/)**

The reference covers all ten packages:

- `@iskra-bun/core`
- `@iskra-bun/web-kit`
- `@iskra-bun/db-kit`
- `@iskra-bun/socket-kit`
- `@iskra-bun/kv-kit`
- `@iskra-bun/worker-kit`
- `@iskra-bun/process-kit`
- `@iskra-bun/desktop-kit` _(experimental)_
- `@iskra-bun/mobile-kit` _(experimental)_
- `@iskra-bun/db-oracle` _(experimental)_

## Regenerating locally

```bash
cd website
bun run api    # runs TypeDoc -> public/api
bun run build  # builds the site (TypeDoc output is served at /api/)
```

:::note
The API reference is generated HTML and is not committed to the repository; the
documentation workflow regenerates it on every deploy.
:::
