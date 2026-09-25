import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { CacheFeature } from '../src/features/cache';

describe('CacheFeature memory adapter', () => {
    it('stores and returns copies, as Redis does', async () => {
        // Regression: it kept and returned the caller's object, so a change to
        // a value read from the cache (a request adding a role) reached every
        // request that read it afterwards.
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        const value = { roles: ['viewer'] };
        await cache.client.set('user:1', value, 60);
        value.roles.push('admin');

        const read = (await cache.client.get('user:1')) as { roles: string[] };
        expect(read.roles).toEqual(['viewer']);
        read.roles.push('admin');
        expect(((await cache.client.get('user:1')) as { roles: string[] }).roles).toEqual(['viewer']);

        await cache.client.setIfExists?.('user:1', value, 60);
        value.roles.push('owner');
        expect(((await cache.client.get('user:1')) as { roles: string[] }).roles).toEqual(['viewer', 'admin']);

        await kernel.shutdown();
    });
});
