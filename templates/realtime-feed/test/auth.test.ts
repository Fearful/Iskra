import { describe, it, expect, beforeAll } from 'bun:test';
import type { Hono } from 'hono';
import { Kernel } from '@iskra-bun/web-kit';
import router, { eventBus } from '../src/interfaces/http/router.ts';
import { createAuthFeatures, parseApiKeys, POSTS_PER_MINUTE } from '../src/auth.ts';

const ANA_KEY = 'ana-key-0123456789abcdef0123456789abcdef';
const BOB_KEY = 'bob-key-0123456789abcdef0123456789abcdef';

describe('realtime-feed posting', () => {
    let app: Hono;
    const broadcast: unknown[] = [];

    beforeAll(async () => {
        // Same wiring as src/main.ts.
        const kernel = new Kernel({ logger: false });
        for (const feature of createAuthFeatures(parseApiKeys(`ana:author:${ANA_KEY},bob:author:${BOB_KEY}`))) {
            kernel.registerFeature(feature);
        }
        await kernel.initialize();
        kernel.getApp().route('/', router);
        app = kernel.getApp();
        eventBus.on('feed:new-post', (post) => broadcast.push(post));
    });

    const post = (body: unknown, key?: string) =>
        app.request('/feed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
            body: JSON.stringify(body),
        });

    it('refuses anonymous posts, which used to be broadcast to every socket', async () => {
        const res = await post({ content: 'spam', authorId: '6f1c1f9e-3f5a-4a53-9a57-d3b0c4f0a111' });
        expect(res.status).toBe(401);
        expect(broadcast).toEqual([]);
    });

    it('takes the author from the API key, not from the body', async () => {
        const res = await post({ content: 'hola', authorId: 'bob' }, ANA_KEY);
        expect(res.status).toBe(201);
        expect((await res.json()).authorId).toBe('ana');
        expect((await (await app.request('/feed')).json())[0]).toMatchObject({ content: 'hola', authorId: 'ana' });
    });

    it('limits posts per author', async () => {
        const statuses: number[] = [];
        for (let i = 0; i <= POSTS_PER_MINUTE; i++) statuses.push((await post({ content: `#${i}` }, BOB_KEY)).status);
        expect(statuses.slice(0, POSTS_PER_MINUTE).every((s) => s === 201)).toBe(true);
        expect(statuses[POSTS_PER_MINUTE]).toBe(429);
        // Another author has their own budget, and reading is not limited.
        expect((await post({ content: 'sigo' }, ANA_KEY)).status).toBe(201);
        expect((await app.request('/feed')).status).toBe(200);
    });
});
