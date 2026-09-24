---
"@iskra-bun/web-kit": patch
---

`Kernel` is exported from the package entry as a class again for TypeScript: `types.ts` also re-exported it type-only, and the colliding `export *` made `import { Kernel } from "@iskra-bun/web-kit"; new Kernel()` fail to typecheck (TS1362), although it worked at runtime.
