---
"create-iskra": patch
---

The bundled templates' `bun dev` script sets `NODE_ENV=development`, since Iskra now applies its production defaults when `NODE_ENV` is unset. `starter-app` gains a `dev` script.
