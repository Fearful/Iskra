import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { CorsFeature } from '../src/features/cors';
import { RequestIdFeature } from '../src/features/request-id';
import { HealthCheckFeature } from '../src/features/health';

describe('Web-Kit Kernel', () => {
    it('should initialize features correctly', async () => {
        const kernel = new Kernel();
        const cors = new CorsFeature();
        const requestId = new RequestIdFeature();

        kernel.registerFeature(cors);
        kernel.registerFeature(requestId);

        await kernel.initialize();
        expect(kernel.getFeatureNames()).toEqual(['cors', 'request-id']);

        const app = kernel.getApp();
        expect(app).toBeDefined();

        // Add a test route
        app.get('/test', (c) => c.json({ ok: true, id: c.get('requestId') }));

        const res = await app.request('/test');
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.id).toBeDefined();
        expect(res.headers.get('X-Request-ID')).toBe(data.id);
    });

    it('should handle health checks', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature());
        await kernel.initialize();

        const app = kernel.getApp();
        const res = await app.request('/health');
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('ok');
    });
});
