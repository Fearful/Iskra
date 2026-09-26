import { Kernel } from '../src/kernel';
import { RateLimitFeature } from '../src/features/rate-limit';
import { CacheFeature } from '../src/features/cache';

// ============================================================================
// Example 1: Basic Rate Limiting
// ============================================================================

const basicKernel = new Kernel({ port: 8001 });

// Simple rate limiting: 10 requests per minute
basicKernel.registerFeature(
    new RateLimitFeature({
        windowMs: 60 * 1000, // 1 minute
        max: 10, // 10 requests per window
    }),
);

// Initialize before adding routes: a route added earlier skips the features' middleware.
await basicKernel.initialize();

basicKernel.getApp().get('/', (c) => {
    return c.json({
        message: 'Rate limited: 10 requests per minute',
        remaining: c.res.headers.get('X-RateLimit-Remaining'),
        limit: c.res.headers.get('X-RateLimit-Limit'),
    });
});

// ============================================================================
// Example 8: Rate Limiting with Cache Store
// ============================================================================

const cacheStoreKernel = new Kernel({ port: 8008 });

// Use Redis/Memory cache for distributed rate limiting
cacheStoreKernel.registerFeature(
    new CacheFeature({
        adapter: 'memory', // using memory for example simplicity
    }),
);

cacheStoreKernel.registerFeature(
    new RateLimitFeature({
        windowMs: 60 * 1000,
        max: 100,
        store: 'cache', // Use cache feature for storage
    }),
);

// Initialize before adding routes: a route added earlier skips the features' middleware.
await cacheStoreKernel.initialize();

cacheStoreKernel.getApp().get('/distributed', (c) => {
    return c.json({
        message: 'Rate limit shared across all server instances (simulated)',
    });
});

if (import.meta.main) {
    console.log('Starting Basic Rate Limit Example on port 8001...');
    await basicKernel.start();
}
