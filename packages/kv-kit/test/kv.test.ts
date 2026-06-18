import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';

describe('KVKit', () => {
    let app: App;
    let kv: KVManager;

    beforeAll(async () => {
        app = new App({
            name: 'KVTest',
            kv: { driver: 'memory' }
        });

        kv = new KVManager();
        app.register(kv);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('should set and get values', async () => {
        await kv.set('foo', 'bar');
        const val = await kv.get('foo');
        expect(val).toBe('bar');
    });

    it('should handle complex objects', async () => {
        const obj = { x: 1, y: 2 };
        await kv.set('obj', obj);
        const val = await kv.get('obj');
        expect(val).toEqual(obj);
    });

    it('should respect TTL', async () => {
        await kv.set('temp', 'gone', 0.1); // 100ms
        const imm = await kv.get('temp');
        expect(imm).toBe('gone');

        await new Promise(r => setTimeout(r, 150));
        const gone = await kv.get('temp');
        expect(gone).toBeUndefined();
    });

    it('should delete keys', async () => {
        await kv.set('to-delete', 'value');
        expect(await kv.get('to-delete')).toBe('value');

        await kv.del('to-delete');
        expect(await kv.get('to-delete')).toBeUndefined();
    });

    it('should check key existence with has()', async () => {
        await kv.set('exists-key', 'yes');
        expect(await kv.has('exists-key')).toBe(true);
        expect(await kv.has('nonexistent')).toBe(false);
    });

    it('should return undefined for nonexistent keys', async () => {
        const val = await kv.get('never-set');
        expect(val).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
        await kv.set('overwrite', 'first');
        expect(await kv.get('overwrite')).toBe('first');

        await kv.set('overwrite', 'second');
        expect(await kv.get('overwrite')).toBe('second');
    });

    it('should handle arrays as values', async () => {
        const arr = [1, 'two', { three: 3 }];
        await kv.set('array', arr);
        const val = await kv.get('array');
        expect(val).toEqual(arr);
    });

    it('should handle deleting nonexistent keys without error', async () => {
        // Should not throw
        await kv.del('never-existed');
    });

    it('should expire TTL keys and not return them via has()', async () => {
        await kv.set('ttl-has', 'temp', 0.1);
        expect(await kv.has('ttl-has')).toBe(true);

        await new Promise(r => setTimeout(r, 150));
        expect(await kv.has('ttl-has')).toBe(false);
    });
});
