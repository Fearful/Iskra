---
"@iskra-bun/web-kit": minor
---

`AuthFeature` accepts `rateLimit: { max?, windowMs? }` to tune the per-IP limit on the auth routes (still 20 requests / 15 min by default), or `rateLimit: false` to turn it off. The fixed limit made a backend that signs users in through the SDKs, all from one IP, lock everyone out after 20 requests.
