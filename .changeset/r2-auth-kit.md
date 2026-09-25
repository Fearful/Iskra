---
"@iskra-bun/auth-kit": minor
---

**Security (breaking):** with `NODE_ENV=production`, `createBetterAuth` refuses a secret that is still a sample value: one containing `change-me`, `dev-secret`, `dev-only`, `your-secret` or `placeholder`, compared without case, `-`, `_`, `.` or spaces (so `changeme` and `CHANGE_ME` count too). A sample secret copied from docs or an `.env.example` is public, and it signs better-auth's session cookie cache, which is trusted without a database lookup: anyone could forge a session for any user. The error names the matching word, never the secret.
