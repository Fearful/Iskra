import { afterEach, describe, expect, test } from 'bun:test';
import { App } from '@iskra-bun/core';
import { OracleDriver } from '../src/driver';

const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;

/** A stream of `bytes` in chunks of `size`. */
function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream({
        pull(controller) {
            if (offset >= bytes.length) return controller.close();
            controller.enqueue(bytes.subarray(offset, offset + size));
            offset += size;
        },
    });
}

/** Feeds `stream` to the driver's reader, with queries `ids` pending. */
async function read(driver: OracleDriver, stream: ReadableStream<Uint8Array>, ids: number[]) {
    const settled = new Map<number, unknown>();
    const pending = new Map(
        ids.map((id) => [
            id,
            {
                resolve: (data: unknown) => settled.set(id, data),
                reject: (err: unknown) => settled.set(id, err),
                timer: null,
            },
        ]),
    );
    const waiter = { resolve: () => {}, reject: () => {} };
    // A stand-in for the bridge process: never the driver's own.
    await (driver as any).readStream({}, stream, pending, waiter);
    return settled;
}

describe('OracleDriver response framing', () => {
    // Every chunk re-split the whole accumulated buffer: quadratic in the size
    // of a result (a 32 MiB line took 5.5 s of the event loop).
    test('reads a large response in time linear in its size', async () => {
        const blob = 'x'.repeat(8 * 1024 * 1024);
        const line = new TextEncoder().encode(JSON.stringify({ id: 1, data: [{ blob }] }) + '\n');
        const started = performance.now();
        const settled = await read(new OracleDriver(FAKE_BRIDGE), chunked(line, 4096), [1]);
        const elapsed = performance.now() - started;

        expect((settled.get(1) as Array<{ blob: string }>)[0]!.blob.length).toBe(blob.length);
        expect(elapsed).toBeLessThan(1000);
    });

    test('decodes characters split across chunks, and several lines per chunk', async () => {
        const text = [
            JSON.stringify({ id: 1, data: [{ name: 'Añejo €uro 🎉' }] }),
            JSON.stringify({ id: 2, data: [{ name: 'Ωmega' }] }),
            '',
        ].join('\n');
        const settled = await read(new OracleDriver(FAKE_BRIDGE), chunked(new TextEncoder().encode(text), 7), [1, 2]);
        expect(settled.get(1)).toEqual([{ name: 'Añejo €uro 🎉' }]);
        expect(settled.get(2)).toEqual([{ name: 'Ωmega' }]);
    });

    test('rejects the query whose response exceeds maxResponseBytes, and reads on', async () => {
        const big = JSON.stringify({ id: 1, data: [{ blob: 'y'.repeat(5000) }] });
        const small = JSON.stringify({ id: 2, data: [{ ok: true }] });
        const bytes = new TextEncoder().encode(`${big}\n${small}\n`);
        const settled = await read(new OracleDriver(FAKE_BRIDGE, 30_000, 30_000, 1024), chunked(bytes, 300), [1, 2]);
        expect(String(settled.get(1))).toMatch(/exceeds maxResponseBytes \(1024 bytes\)/);
        expect(settled.get(2)).toEqual([{ ok: true }]);
    });
});

describe('OracleDriver response cap through the bridge', () => {
    const prevConn = process.env.ORA_CONN;
    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test('fails only the oversized query', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE, 5000, 30_000, 64 * 1024);
        await driver.init(new App({ name: 'OracleFraming', logger: { level: 'silent' } } as any));
        await driver.start();
        try {
            await expect(driver.query('BIG_RESPONSE_TEST:200000')).rejects.toThrow(/exceeds maxResponseBytes/);
            const rows = (await driver.query('BIG_RESPONSE_TEST:1000')) as Array<{ blob: string }>;
            expect(rows[0]!.blob.length).toBe(1000);
            expect(await driver.query('SELECT 1 FROM dual')).toEqual([{ echo: 'SELECT 1 FROM dual', params: [] }]);
        } finally {
            await driver.stop();
        }
    });
});
