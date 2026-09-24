---
"create-iskra": patch
---

`npm create iskra`, `npx create-iskra` and `bunx create-iskra` work: run through the `node_modules/.bin` link, the CLI compared the link's path with its own and did nothing. Ctrl-C at a prompt cancels instead of scaffolding with the defaults. The generated project gets a `.gitignore` (npm leaves them out of the package) and a valid package name for targets such as `my-app/` or `.`. The templates read `PORT` and exit with code 1 when the app fails to start. `src` is published, as the `bun` export condition points at it.
