---
"@iskra-bun/web-kit": minor
---

`Router` groups routes with the middleware they share: `router.group(prefix, ...middleware)`, subgroups that inherit it, and `use()` for the routes added after it. Routes are registered by priority (a static segment before a parameter before a wildcard, a named method before `all()`), so `/users/me` wins over `/users/:id` whatever the order they were added, and a route added twice throws. `group.unmatched()` answers what no route under the prefix takes: it runs the group's middleware (or `use`) first, so a guest gets the auth check's 401 rather than a 404 that reveals which paths exist, then 404, or 405 with `Allow` with `then: 'auto'`, by the response contract. `WebPlugin`'s `router` takes a `Router` (compiled after the features' middleware) or a Hono app as before.
