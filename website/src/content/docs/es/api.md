---
title: Referencia de API
description: Referencia de API generada automáticamente con TypeDoc para cada paquete de Iskra.
---

La referencia de API completa se genera a partir del código fuente TypeScript de cada paquete con [TypeDoc](https://typedoc.org).

👉 **[Abrir la referencia de API generada](/api/)**

La referencia cubre los diez paquetes:

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

## Regenerar localmente

```bash
cd website
bun run api    # corre TypeDoc -> public/api
bun run build  # construye el sitio (la salida de TypeDoc se sirve en /api/)
```

:::note
La referencia de API es HTML generado y no se commitea al repositorio; el flujo de
documentación la regenera en cada deploy.
:::
