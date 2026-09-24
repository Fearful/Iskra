---
"@iskra-bun/process-kit": patch
---

Children no longer outlive the app when it exits before `stop()` is done with them (the App's `shutdownTimeoutMs`, a second signal, or any `process.exit()`): the process groups still running are sent SIGKILL on exit. Since each child runs in its own process group, neither the terminal's Ctrl-C nor the parent's death reached them, and they were left running under init.
