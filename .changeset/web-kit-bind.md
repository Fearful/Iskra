---
"@iskra-bun/web-kit": minor
---

`bindBody(c, schema, options)` and `bindQuery(c, schema, options)` parse a request's body and query in a handler and return them typed, or throw a `ValidationError` the response contract answers. `caseInsensitiveKeys` matches the request's keys to the schema's ignoring case, nested objects and arrays included (`{ "NOMBRE": "Ana" }` fills `nombre`, as Go's encoding/json does); `allowForm` accepts urlencoded and multipart bodies; a query field declared as an array takes every value of a repeated parameter. `queryParams(c)` gives every query parameter, repeated ones as arrays. The `details` of a failed validation can be `'flatten'` (the default), `'issues'`, `'fields'` or a function, per call or in the contract's `validationDetails`. `validate()` takes the same options. core's new `UNSUPPORTED_MEDIA_TYPE` code answers 415.

**Breaking:** `validate()` and `validateJson()` answer malformed JSON with a 400 (`BAD_REQUEST`) and a body that is neither JSON nor a form with a 415, instead of validating it as `{}`.
