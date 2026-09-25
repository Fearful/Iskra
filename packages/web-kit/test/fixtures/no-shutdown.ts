// Starts every feature that keeps a sweep timer, serves one request and ends
// without kernel.shutdown(): the process must exit on its own.
import { Kernel } from '../../src/kernel';
import { AuthFeature } from '../../src/features/auth/index';
import { CacheFeature } from '../../src/features/cache';
import { RateLimitFeature } from '../../src/features/rate-limit';
import { SessionFeature } from '../../src/features/session';
import type { Feature } from '../../src/types';

const fakeCreateAuth = (() => ({
    handler: async () => new Response('ok'),
    api: { getSession: async () => null },
})) as unknown as ConstructorParameters<typeof AuthFeature>[1];
const fakeDb = { name: 'db', db: {}, adapter: 'sqlite', async initialize() {} } as Feature;

const kernel = new Kernel({ logger: false });
kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
kernel.registerFeature(new RateLimitFeature());
kernel.registerFeature(new SessionFeature({ store: 'memory', secret: 'x'.repeat(40) }));
kernel.registerFeature(fakeDb);
kernel.registerFeature(new AuthFeature({ secret: 'y'.repeat(40) }, fakeCreateAuth));
await kernel.initialize();

const res = await kernel.getApp().request('/api/sso/sign-in/email', { method: 'POST' });
console.log(`STATUS ${res.status}`);
