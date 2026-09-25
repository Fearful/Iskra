import { describe, it, expect, spyOn } from 'bun:test';
import { Kernel } from '../src/kernel';
import { LoggerFeature } from '../src/features/logger';
import { RequestIdFeature } from '../src/features/request-id';
import type { LoggerConfig } from '../src/types';

/** Which of debug/info/warn/error a handler's `c.get("logger")` writes at `level`. */
async function written(level: LoggerConfig['level']): Promise<string[]> {
    const kernel = new Kernel();
    kernel.registerFeature(new LoggerFeature({ level }));
    await kernel.initialize();
    kernel.getApp().get('/', (c) => {
        const logger = c.get('logger');
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        return c.text('ok');
    });
    // Only around the request, and always restored: other test files spy on
    // the console too (a leftover spy broke mailer-kit's "silent" test).
    const spies = (['debug', 'log', 'warn', 'error'] as const).map((m) =>
        spyOn(console, m).mockImplementation(() => {}),
    );
    try {
        await kernel.getApp().request('/');
        // Read before mockRestore(), which also clears the recorded calls.
        const [debug, log, warn, error] = spies;
        return [
            ...(debug.mock.calls.some((a) => a[0] === '[DEBUG] d') ? ['debug'] : []),
            ...(log.mock.calls.some((a) => a[0] === '[INFO] i') ? ['info'] : []),
            ...(warn.mock.calls.some((a) => a[0] === '[WARN] w') ? ['warn'] : []),
            ...(error.mock.calls.some((a) => a[0] === '[ERROR] e') ? ['error'] : []),
        ];
    } finally {
        spies.forEach((s) => s.mockRestore());
        await kernel.shutdown();
    }
}

describe('LoggerFeature level', () => {
    it('writes only messages at or above the configured level', async () => {
        // Regression: `level` was ignored and every message was written.
        expect(await written('error')).toEqual(['error']);
        expect(await written('warning')).toEqual(['warn', 'error']);
        expect(await written('info')).toEqual(['info', 'warn', 'error']);
        expect(await written('debug')).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('writes everything without a level, as before', async () => {
        expect(await written(undefined)).toEqual(['debug', 'info', 'warn', 'error']);
    });
});

describe('Request logging and request IDs', () => {
    async function kernelWith(...features: (LoggerFeature | RequestIdFeature)[]) {
        const kernel = new Kernel({ logger: false });
        for (const feature of features) kernel.registerFeature(feature);
        await kernel.initialize();
        kernel.getApp().get('/', (c) => c.json({ id: c.get('requestId') ?? null }));
        return kernel;
    }

    it('escapes control characters of the decoded path, so a URL cannot forge a log line', async () => {
        const kernel = await kernelWith(new LoggerFeature({ logRequests: true }));
        kernel.getApp().get('/products/:slug', (c) => c.text('product'));
        // Over a socket: app.request() does not route a path with a decoded newline.
        const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: kernel.getApp().fetch });
        const log = spyOn(console, 'log').mockImplementation(() => {});
        try {
            await fetch(`http://127.0.0.1:${server.port}/products/shoes%0A[WARN]%20Login%20succeeded%20for%20admin`);
            const lines = log.mock.calls.map((a) => String(a[0]));
            const line = lines.find((l) => l.startsWith('[INFO] Incoming request'));
            expect(line).toBe('[INFO] Incoming request GET /products/shoes\\u000a[WARN] Login succeeded for admin');
            expect(lines.some((l) => l.includes('\n'))).toBe(false);
        } finally {
            log.mockRestore();
            server.stop(true);
            await kernel.shutdown();
        }
    });

    it('keeps a well-formed incoming request ID and replaces anything else', async () => {
        const kernel = await kernelWith(new RequestIdFeature());
        const idFor = async (value: string) => {
            const res = await kernel.getApp().request('/', { headers: { 'X-Request-ID': value } });
            return { body: (await res.json()).id as string, header: res.headers.get('X-Request-ID') };
        };

        const trace = 'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1';
        expect(await idFor(trace)).toEqual({ body: trace, header: trace });

        for (const bad of ['has spaces in it', 'x'.repeat(201), 'caf\u00e9']) {
            const { body, header } = await idFor(bad);
            expect(body).not.toBe(bad);
            expect(body).toMatch(/^[0-9a-f-]{36}$/);
            expect(header).toBe(body);
        }

        await kernel.shutdown();
    });
});
