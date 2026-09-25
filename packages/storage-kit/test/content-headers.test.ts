import { describe, expect, it } from 'bun:test';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageAdapter } from '../src/adapters/s3';
import { contentTypeFor, dispositionFor } from '../src';

// An upload named logo.svg or invoice.html was stored as image/svg+xml or
// text/html with no Content-Disposition, and presigned GETs served it inline:
// its scripts ran on the bucket's origin (stored XSS).

function s3() {
    const adapter = new S3StorageAdapter({
        adapter: 's3',
        connection: { region: 'us-east-1', bucket: 'b', accessKey: 'AKID', secretKey: 'secret' },
    });
    (adapter as any).connected = true;
    const sent: any[] = [];
    (adapter as any).client.send = async (cmd: any) => {
        sent.push(cmd);
        return {};
    };
    return { adapter, sent };
}

describe('contentTypeFor / dispositionFor', () => {
    it('types a file by its extension and never as active content', () => {
        expect(contentTypeFor('photo.JPG')).toBe('image/jpeg');
        expect(contentTypeFor('docs/report.pdf')).toBe('application/pdf');
        for (const name of ['logo.svg', 'invoice.html', 'page.xhtml', 'feed.xml', 'app.js', 'README', 'a.svg/x']) {
            expect(contentTypeFor(name)).toBe('application/octet-stream');
        }
    });

    it('serves only raster images inline', () => {
        expect(dispositionFor('image/png')).toBe('inline');
        expect(dispositionFor('IMAGE/JPEG; charset=binary')).toBe('inline');
        for (const type of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/pdf']) {
            expect(dispositionFor(type)).toBe('attachment');
        }
    });
});

describe('S3StorageAdapter content headers', () => {
    it('stores a Content-Disposition with every object', async () => {
        const { adapter, sent } = s3();
        await adapter.put('p/logo.svg', new Uint8Array([60]));
        await adapter.put('p/photo.png', new Uint8Array([1]));
        await adapter.put('p/page.html', new Uint8Array([60]), { contentType: 'text/html' });
        await adapter.put('p/inline.pdf', new Uint8Array([1]), { contentDisposition: 'inline' });
        const puts = sent.filter((c) => c instanceof PutObjectCommand).map((c) => c.input);
        expect(puts.map((p) => [p.ContentType, p.ContentDisposition])).toEqual([
            ['application/octet-stream', 'attachment'],
            ['image/png', 'inline'],
            // A caller's explicit type is kept, but still downloaded.
            ['text/html', 'attachment'],
            ['application/pdf', 'inline'],
        ]);
    });

    it('signs the type and disposition into presigned URLs', async () => {
        const { adapter } = s3();
        const svg = new URL(await adapter.url('p/logo.svg'));
        expect(svg.searchParams.get('response-content-type')).toBe('application/octet-stream');
        expect(svg.searchParams.get('response-content-disposition')).toBe('attachment');

        const png = new URL(await adapter.url('p/photo.png', 60));
        expect(png.searchParams.get('response-content-type')).toBe('image/png');
        expect(png.searchParams.get('response-content-disposition')).toBe('inline');

        const chosen = new URL(await adapter.url('p/r.pdf', 60, { contentDisposition: 'inline' }));
        expect(chosen.searchParams.get('response-content-disposition')).toBe('inline');
        expect(chosen.searchParams.get('X-Amz-Signature')).toBeTruthy();
    });
});
