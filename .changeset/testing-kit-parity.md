---
"@iskra-bun/testing-kit": minor
---

`@iskra-bun/testing-kit/parity` compares a service with its replacement on the same requests (`compareCase`, `compareAll`, `formatReport`): status, chosen headers and body, as JSON values without the `ignorePaths`, or byte for byte in `exact` mode (reading Go's `<` escapes with `goHtmlEscape`). Only GET and HEAD unless `allowWrite`. `casesFromHar()` reads a HAR capture, and the `iskra-parity` command runs it from the terminal, exiting 1 on a difference.
