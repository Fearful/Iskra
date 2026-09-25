---
"create-iskra": patch
---

The `starter-app` template ships with `debug: false` and info-level logging (it logged at debug level), caps the user name at 100 characters and the in-memory user store at 1000 users (`POST /users` answers 507 when full), and comes with a test.
