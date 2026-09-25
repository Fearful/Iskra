---
"create-iskra": patch
---

The `starter-app` template ships with `debug: false` and info-level logging (it logged at debug level), caps the user name at 100 characters and the in-memory user store at 1000 users (`POST /users` answers 507 when full), and comes with a test. The Dockerfiles of both templates copy the compiled binary root-owned and read-only (`--chmod=0555`): with `--chown=1001:0` the user the app runs as could overwrite it, so a compromise of the app could persist. The runtime image is pinned to `ubi9/ubi-minimal:9.8` instead of `:latest`.
