---
"@iskra-bun/web-kit": patch
---

Internal refactor: the email, storage, and auth features now delegate to the new standalone `@iskra-bun/mailer-kit`, `@iskra-bun/storage-kit`, and `@iskra-bun/auth-kit` packages instead of bundling their own copies. The public API (`EmailFeature`, `StorageFeature`, `AuthFeature`, and the types/adapters they re-export) is unchanged. The now-transitive `nodemailer`, `@sendgrid/mail`, and `@aws-sdk/*` direct dependencies were dropped. Note: `MockEmailAdapter` no longer prints a `console.log` line on send (it is now silent).
