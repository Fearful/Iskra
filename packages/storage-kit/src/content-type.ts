/**
 * The Content-Type stored and served for each extension. Anything else,
 * including what a browser runs as a page (HTML, SVG, XML, JavaScript), is
 * `application/octet-stream`.
 */
const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
};

/** Raster images: a browser only ever displays them, so they are the only types served inline. */
const INLINE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/x-icon',
]);

/**
 * The Content-Type for a file, from its extension only: the type an uploader
 * sends (or Bun derives from the name, e.g. `image/svg+xml`) is never trusted.
 */
export function contentTypeFor(filename: string): string {
    const base = filename.split(/[\\/]/).pop() ?? '';
    const dot = base.lastIndexOf('.');
    return (dot === -1 ? undefined : CONTENT_TYPES[base.slice(dot + 1).toLowerCase()]) ?? 'application/octet-stream';
}

/**
 * `inline` for raster images, `attachment` (a download) for anything else:
 * rendered inline, an HTML or SVG file runs its scripts on the origin serving it.
 */
export function dispositionFor(contentType: string): 'inline' | 'attachment' {
    return INLINE_TYPES.has(contentType.split(';')[0].trim().toLowerCase()) ? 'inline' : 'attachment';
}
