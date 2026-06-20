---
"@iskra-bun/db-oracle": patch
---

Reject all pending requests when the Oracle bridge reports a fatal error or exits, instead of leaving their promises unsettled (which previously caused silent hangs and a memory leak).
