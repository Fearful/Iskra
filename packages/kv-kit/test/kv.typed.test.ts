import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';

interface User {
    id: number;
    name: string;
}

describe('KVKit — typed generics', () => {
    let app: App;
    let kv: KVManager;

    beforeAll(async () => {
        app = new App({
            name: 'KVTypedTest',
            kv: { driver: 'memory' },
        });
        kv = new KVManager();
        app.register(kv);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('typed round-trip: set<User> and get<User> returns the stored object', async () => {
        const user: User = { id: 1, name: 'Alice' };
        await kv.set<User>('user:1', user);
        const result = await kv.get<User>('user:1');
        // result is typed as User | undefined; accessing .id and .name is valid
        expect(result).toEqual(user);
        expect(result?.id).toBe(1);
        expect(result?.name).toBe('Alice');
    });

    it('get<User> of a missing key returns undefined', async () => {
        const result = await kv.get<User>('user:nonexistent');
        expect(result).toBeUndefined();
    });

    it('overwriting a typed key returns the new value', async () => {
        await kv.set<User>('user:2', { id: 2, name: 'Bob' });
        await kv.set<User>('user:2', { id: 2, name: 'Bobby' });
        const result = await kv.get<User>('user:2');
        expect(result?.name).toBe('Bobby');
    });

    it('default T=unknown: get without type arg compiles and returns unknown | undefined', async () => {
        await kv.set('raw-key', 42);
        const result = await kv.get('raw-key');
        // result is unknown | undefined; we narrow before use
        expect(result).toBe(42);
    });
});
