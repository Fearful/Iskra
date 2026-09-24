---
"@iskra-bun/core": minor
"@iskra-bun/web-kit": minor
"@iskra-bun/auth-kit": minor
"@iskra-bun/db-kit": minor
"@iskra-bun/mailer-kit": minor
---

**Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

- `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
- `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
- `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
- `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).
