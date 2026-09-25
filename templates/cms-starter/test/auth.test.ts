import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Hono } from 'hono';
import { Kernel } from '@iskra-bun/web-kit';
import { ContentService } from '../src/domain/content/content.service.ts';
import { createContentRouter } from '../src/interfaces/http/router.ts';
import { createApiKeyFeature, parseApiKeys } from '../src/auth.ts';

const EDITOR_KEY = 'editor-key-0123456789abcdef0123456789abcdef';

describe('cms-starter access control', () => {
    let client: Database;
    let app: Hono;

    beforeAll(async () => {
        client = new Database(':memory:');
        // The service only reads `.db` from its DbDriver.
        const service = new ContentService({ db: drizzle(client) } as unknown as ConstructorParameters<
            typeof ContentService
        >[0]);
        await service.initTables();

        // Same wiring as src/main.ts.
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(createApiKeyFeature(parseApiKeys(`ana:editor:${EDITOR_KEY}`)));
        await kernel.initialize();
        kernel.getApp().route('/', createContentRouter(service));
        app = kernel.getApp();
    });

    afterAll(() => client.close());

    const call = (method: string, path: string, opts: { key?: string; body?: unknown; json?: boolean } = {}) =>
        app.request(path, {
            method,
            headers: {
                ...(opts.key ? { 'X-API-Key': opts.key } : {}),
                ...(opts.body !== undefined || opts.json ? { 'Content-Type': 'application/json' } : {}),
            },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });

    const draft = (slug: string) => ({ slug, title: 'Hola', body: 'Secreto', type: 'post' });

    it('requires an editor for every change', async () => {
        expect((await call('POST', '/content', { body: draft('anonimo') })).status).toBe(401);
        const created = await call('POST', '/content', { key: EDITOR_KEY, body: draft('del-editor') });
        expect(created.status).toBe(201);
        const { id } = await created.json();

        expect((await call('PUT', `/content/${id}`, { body: { title: 'x' } })).status).toBe(401);
        expect((await call('POST', `/content/${id}/publish`, { json: true })).status).toBe(401);
        expect((await call('POST', `/content/${id}/unpublish`, { json: true })).status).toBe(401);
        expect((await call('DELETE', `/content/${id}`)).status).toBe(401);
        expect((await call('GET', `/content/${id}/versions`)).status).toBe(401);
        expect((await call('GET', `/content/${id}/versions`, { key: EDITOR_KEY })).status).toBe(200);
    });

    it('shows the public only published content, whatever it asks for', async () => {
        const { id: draftId } = await (
            await call('POST', '/content', { key: EDITOR_KEY, body: draft('borrador') })
        ).json();
        const { id: liveId } = await (
            await call('POST', '/content', { key: EDITOR_KEY, body: draft('publicado') })
        ).json();
        expect((await call('POST', `/content/${liveId}/publish`, { key: EDITOR_KEY, json: true })).status).toBe(200);

        for (const query of ['', '?status=draft']) {
            const listed = await (await call('GET', `/content${query}`)).json();
            expect(listed.map((c: { slug: string }) => c.slug)).toEqual(['publicado']);
        }
        expect((await call('GET', `/content/${draftId}`)).status).toBe(404);
        expect((await call('GET', `/content/${liveId}`)).status).toBe(200);

        // Editors still see drafts.
        const drafts = await (await call('GET', '/content?status=draft', { key: EDITOR_KEY })).json();
        expect(drafts.map((c: { slug: string }) => c.slug)).toContain('borrador');
        expect((await call('GET', `/content/${draftId}`, { key: EDITOR_KEY })).status).toBe(200);
    });

    it('refuses to publish from a plain form post', async () => {
        const { id } = await (await call('POST', '/content', { key: EDITOR_KEY, body: draft('form') })).json();
        const form = await app.request(`/content/${id}/publish`, {
            method: 'POST',
            headers: { 'X-API-Key': EDITOR_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'x=1',
        });
        expect(form.status).toBe(415);
    });
});
