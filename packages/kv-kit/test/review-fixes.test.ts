import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';
import { MemoryAdapter } from '../src/adapters/memory';
import { RedisAdapter } from '../src/adapters/redis';

describe('MemoryAdapter TTLs', () => {
    let adapter: MemoryAdapter;
    afterEach(() => adapter.disconnect());

    it("keeps a key whose TTL exceeds setTimeout's ~24.8-day limit", async () => {
        adapter = new MemoryAdapter();
        await adapter.set('session', { user: 1 }, 30 * 24 * 3600);
        await Bun.sleep(20);
        // The overflowed timer used to fire at once.
        expect(await adapter.get<{ user: number }>('session')).toEqual({ user: 1 });
    });

    it('rejects a negative or non-finite TTL instead of deleting the key at once', async () => {
        adapter = new MemoryAdapter();
        await adapter.set('k', 'kept');
        for (const ttl of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(adapter.set('k', 'lost', ttl)).rejects.toThrow(RangeError);
        }
        expect(await adapter.get<string>('k')).toBe('kept');
    });

    it('treats a TTL of 0 as no expiry', async () => {
        adapter = new MemoryAdapter();
        await adapter.set('k', 1, 0);
        await Bun.sleep(5);
        expect(await adapter.get<number>('k')).toBe(1);
    });
});

describe('RedisAdapter', () => {
    it('rejects a negative TTL before sending anything', async () => {
        const adapter = new RedisAdapter({});
        const sent: unknown[] = [];
        (adapter as any).client = { set: async (...args: unknown[]) => sent.push(args), pipeline: () => ({}) };
        await expect(adapter.set('k', 1, -1)).rejects.toThrow(RangeError);
        await expect(adapter.mset([['k', 1]], -1)).rejects.toThrow(RangeError);
        expect(sent).toEqual([]);
    });

    it('fails the app start when Redis is unreachable, without leaking the password', async () => {
        const errors: unknown[] = [];
        const app = new App({
            name: 'KvUnreachable',
            logger: { level: 'silent' },
            kv: { driver: 'redis', connection: { url: 'redis://:s3cret@127.0.0.1:1', maxRetriesPerRequest: 0 } },
        } as any);
        (app.logger as any).warn = (obj: unknown) => errors.push(obj);
        app.register(new KVManager());

        const error = await app.start().then(
            () => undefined,
            (e: unknown) => e,
        );
        // start() used to resolve and the first command failed (or hung) later.
        expect(error).toBeDefined();
        expect(String((error as Error).message)).not.toContain('s3cret');
        expect(JSON.stringify(error)).not.toContain('s3cret');
    });
});

describe('RedisAdapter errors', () => {
    // A server that refuses every login, as Redis does after a password rotation.
    function refusingServer() {
        return Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: {
                data(socket) {
                    socket.write('-WRONGPASS invalid username-password pair or user is disabled.\r\n');
                },
            },
        });
    }

    it("keeps AUTH's password out of the logged connection error and the start error", async () => {
        const server = refusingServer();
        const warnings: unknown[] = [];
        const app = new App({
            name: 'KvWrongPassword',
            logger: { level: 'silent' },
            kv: {
                driver: 'redis',
                connection: {
                    url: `redis://:Stale-Prod-Passw0rd@127.0.0.1:${server.port}`,
                    maxRetriesPerRequest: 0,
                    retryStrategy: () => null,
                },
            },
        } as any);
        (app.logger as any).warn = (obj: unknown) => warnings.push(obj);
        app.register(new KVManager());

        try {
            const error = await app.start().then(
                () => undefined,
                (e: unknown) => e as Error,
            );
            expect(error).toBeInstanceOf(Error);

            // ioredis attached `command: { name: 'auth', args: [password] }`.
            const logged = warnings.map((w) => (w as { err?: any }).err).filter(Boolean);
            expect(logged.length).toBeGreaterThan(0);
            expect(logged[0].message).toContain('WRONGPASS');
            expect(logged[0].command).toEqual({ name: 'auth' });
            for (const err of [...logged, error?.cause]) {
                expect(JSON.stringify(err)).not.toContain('Stale-Prod-Passw0rd');
                expect((err as any)?.command?.args).toBeUndefined();
            }
        } finally {
            server.stop(true);
        }
    });
});
