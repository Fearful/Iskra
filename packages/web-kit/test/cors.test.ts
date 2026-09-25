import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { CorsFeature } from '../src/features/cors';
import type { CorsConfig } from '../src/types';

async function allowedOrigin(config: CorsConfig, origin: string): Promise<string | null> {
    const kernel = new Kernel({ logger: false });
    kernel.registerFeature(new CorsFeature(config));
    await kernel.initialize();
    kernel.getApp().get('/', (c) => c.text('ok'));
    const res = await kernel.getApp().request('/', { headers: { Origin: origin } });
    await kernel.shutdown();
    return res.headers.get('access-control-allow-origin');
}

describe('CorsFeature origin', () => {
    it('allows any origin by default', async () => {
        expect(await allowedOrigin({}, 'https://a.example')).toBe('*');
    });

    it('allows only the listed origins', async () => {
        const config = { origin: ['https://a.example'] };
        expect(await allowedOrigin(config, 'https://a.example')).toBe('https://a.example');
        expect(await allowedOrigin(config, 'https://evil.example')).toBeNull();
    });

    it('asks a function, which answers true or false', async () => {
        const config = { origin: (o: string) => o.endsWith('.example') };
        expect(await allowedOrigin(config, 'https://b.example')).toBe('https://b.example');
        expect(await allowedOrigin(config, 'https://evil.test')).toBeNull();
    });
});

describe('CorsFeature credentials', () => {
    it("refuses credentials with any origin ('*' or unset)", async () => {
        // Regression: this sent `Access-Control-Allow-Origin: *` with
        // credentials, which browsers reject, and said nothing on the server.
        const configs: CorsConfig[] = [{ credentials: true }, { credentials: true, origin: '*' }];
        for (const config of configs) {
            const kernel = new Kernel({ logger: false });
            kernel.registerFeature(new CorsFeature(config));
            await expect(kernel.initialize()).rejects.toThrow(/credentials: true.*needs `origin`/);
        }
    });

    it('allows credentials for the listed origins', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new CorsFeature({ credentials: true, origin: ['https://a.example'] }));
        await kernel.initialize();
        kernel.getApp().get('/', (c) => c.text('ok'));
        const res = await kernel.getApp().request('/', { headers: { Origin: 'https://a.example' } });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://a.example');
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
        await kernel.shutdown();
    });
});
