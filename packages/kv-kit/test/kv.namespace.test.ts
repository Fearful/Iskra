/**
 * Tests for namespace/prefix isolation on KVManager.
 *
 * Verifies that:
 * - Two KVManagers with different namespaces don't collide on the same key
 * - A manager without a namespace behaves identically to the current behavior
 * - All operations (get/set/del/has) are namespace-aware
 */
import { describe, it, expect } from 'bun:test';
import { KVManager } from '../src/manager';

describe('KVManager — namespace isolation', () => {
    it('two namespaced managers on different namespaces do NOT collide', async () => {
        const a = new KVManager({ namespace: 'moduleA' });
        const b = new KVManager({ namespace: 'moduleB' });
        await a.connect();
        await b.connect();

        await a.set('config', { version: 1 });
        await b.set('config', { version: 2 });

        expect(await a.get<{ version: number }>('config')).toEqual({ version: 1 });
        expect(await b.get<{ version: number }>('config')).toEqual({ version: 2 });

        await a.disconnect();
        await b.disconnect();
    });

    it('del in one namespace does not affect the other', async () => {
        const a = new KVManager({ namespace: 'ns1' });
        const b = new KVManager({ namespace: 'ns2' });
        await a.connect();
        await b.connect();

        await a.set('key', 'alpha');
        await b.set('key', 'beta');

        await a.del('key');

        expect(await a.get('key')).toBeUndefined();
        expect(await b.get<string>('key')).toBe('beta');

        await a.disconnect();
        await b.disconnect();
    });

    it('has() is namespace-scoped', async () => {
        const a = new KVManager({ namespace: 'nsA' });
        const b = new KVManager({ namespace: 'nsB' });
        await a.connect();
        await b.connect();

        await a.set('present', true);

        expect(await a.has('present')).toBe(true);
        expect(await b.has('present')).toBe(false);

        await a.disconnect();
        await b.disconnect();
    });

    it('manager with no namespace behaves identically to the old behavior', async () => {
        const kv = new KVManager();
        await kv.connect();

        await kv.set('foo', 'bar');
        expect(await kv.get<string>('foo')).toBe('bar');

        await kv.del('foo');
        expect(await kv.get('foo')).toBeUndefined();

        await kv.disconnect();
    });

    it('empty-string namespace option also uses no prefix', async () => {
        const kv = new KVManager({ namespace: '' });
        await kv.connect();

        await kv.set('x', 42);
        expect(await kv.get<number>('x')).toBe(42);

        await kv.disconnect();
    });
});
