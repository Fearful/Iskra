---
"@iskra-bun/core": patch
---

The logger censors sensitive fields at any depth of plain objects and arrays (`db.connection.password`, a top-level `authToken`, `authorization` and `cookie` headers…), not only at the top level and one level down, and without modifying the object passed. It is also faster than the previous path list. The README example no longer listens to an `app:started` event that is never emitted.
