---
"@iskra-bun/core": minor
---

**Security:** the logger redaction every kit relies on, and config loading.

- Errors are serialized and scrubbed like other objects (pino serialized them after the redaction ran): an HTTP client error's `config.headers.Authorization`, or a secret field of the error or of its causes, is censored.
- The bindings of child loggers (`logger.child({ ... })`) are scrubbed too.
- Keys are compared without case, `-` or `_`, and keys ending in `password`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` or `accessKey` are censored: `x-api-key`, `api_key`, `client_secret`, `access_token`, `set-cookie`, `DB_PASSWORD` and `AWS_SECRET_ACCESS_KEY` were written as they were. `proxyAuthorization`, `setCookie` and `sessionId` join the list.
- Messages, and error messages and stacks, have the password of `scheme://user:password@host` URLs and secret-looking query parameters (`?authToken=`, `&X-Amz-Signature=`) masked.
- **Breaking:** `loadAppConfig()` (used by `new App()` without a config) no longer reads `.apprc` files from the working directory, which could add `processes` to spawn or move `otel.endpoint`, and no longer downloads and runs `extends` layers from `github:`, `gitlab:` or `https://` sources on every start. Local `extends` paths still work.
