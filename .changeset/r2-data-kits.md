---
"@iskra-bun/storage-kit": minor
---

**Security** fixes from the data-kits audit (round 2).

- `storage-kit` (**breaking**): files are stored and served with a type from their extension (`contentTypeFor`), and anything but a raster image as a download. The S3 adapter stores a `Content-Disposition` with each object (`attachment` unless it is a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO image; `put(..., { contentDisposition })` to choose), and `url()` signs `response-content-type` and `response-content-disposition` into presigned URLs whatever the object was stored with (`url(path, expiresIn, { contentType, contentDisposition })` to choose): an upload named `logo.svg` or `invoice.html` was stored as `image/svg+xml`/`text/html` and ran its scripts on the bucket's origin. HTML, SVG, XML and JavaScript are now `application/octet-stream`. `put(..., { overwrite: false })` throws the new `FileExistsError` instead of replacing a stored file (S3 `If-None-Match: *`, an exclusive create locally). The plaintext-endpoint guard parses the endpoint as a URL, as the SDK does: `http:/minio:9000`, `http:minio:9000` and `http:\\minio:9000` were accepted without `useSSL: false`; an endpoint that is not an `http(s)` URL is rejected.
