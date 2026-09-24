---
"@iskra-bun/desktop-kit": patch
"@iskra-bun/mobile-kit": patch
---

Be honest about what these experimental kits do: nothing beyond registering in the App lifecycle. `DesktopDriver` no longer logs "Tauri bridge active" (there is no bridge); both drivers now log a warning on start that they are placeholders. The package descriptions and docs say so, without promising a release date, and the unused `@tauri-apps/api` dependency is removed.
