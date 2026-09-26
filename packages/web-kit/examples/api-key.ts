/**
 * API Key Feature Examples
 *
 * This file demonstrates various ways to use the API Key feature:
 * 1. Basic static API keys
 * 2. API keys with scopes
 * 3. Rotating keys (restart with the new staticKeys: lookups read them each request)
 * 4. Protected routes with middleware
 * 5. Multiple extraction strategies
 */

import { Kernel } from '../src/kernel';
import { ApiKeyFeature, requireApiKey, requireScope } from '../src/features/api-key';
import { CacheFeature } from '../src/features/cache';

// ============================================================================
// Example 1: Basic Static API Keys
// ============================================================================

console.log('\n=== Example 1: Basic Static API Keys ===\n');

const basicKernel = new Kernel({ port: 8001 });

basicKernel.registerFeature(
    new ApiKeyFeature({
        staticKeys: [
            {
                key: 'sk_test_1234567890abcdef',
                name: 'Test API Key',
            },
            {
                key: 'sk_prod_abcdef1234567890',
                name: 'Production API Key',
            },
        ],
    }),
);

// Initialize before adding routes: a route added earlier skips the features' middleware.
await basicKernel.initialize();

basicKernel.getApp().get('/', (c) => {
    return c.json({
        message: 'API Key Example - Basic',
        usage: {
            header: 'X-API-Key: sk_test_1234567890abcdef',
            bearer: 'Authorization: Bearer sk_test_1234567890abcdef',
        },
    });
});

// Public endpoint - no API key required
basicKernel.getApp().get('/public', (c) => {
    return c.json({ message: 'This is a public endpoint' });
});

// Protected endpoint - requires API key
basicKernel.getApp().get('/protected', requireApiKey(), (c) => {
    const apiKey = c.get('apiKey');
    return c.json({
        message: 'Protected endpoint',
        keyName: apiKey?.name,
        keyId: apiKey?.id,
    });
});

if (import.meta.main) {
    await basicKernel.start();
}
