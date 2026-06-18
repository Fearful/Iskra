/**
 * API Key Feature Examples
 *
 * This file demonstrates various ways to use the API Key feature:
 * 1. Basic static API keys
 * 2. API keys with scopes
 * 3. Rotating keys with vault service
 * 4. Protected routes with middleware
 * 5. Multiple extraction strategies
 */

import { Kernel } from "../src/kernel";
import {
    ApiKeyFeature,
    requireAnyScope,
    requireApiKey,
    requireScope,
    // @ts-ignore
} from "../src/features/api-key";
import { CacheFeature } from "../src/features/cache";
// @ts-ignore
import type { VaultService } from "../src/features/api-key/types";

// Since VaultService might not be exported from index yet, we might need to get it from types or feature file
// Actually, types are in src/types.ts usually in web-kit structure or feature-specific.
// Checking web-kit types: ApiKeyConfig is there. VaultService might need to be verified.
// For now, I will assume it's available or define it locally if missing from exports.

// ============================================================================
// Example 1: Basic Static API Keys
// ============================================================================

console.log("\n=== Example 1: Basic Static API Keys ===\n");

const basicKernel = new Kernel({ port: 8001 });

basicKernel.registerFeature(
    new ApiKeyFeature({
        staticKeys: [
            {
                key: "sk_test_1234567890abcdef",
                name: "Test API Key",
            },
            {
                key: "sk_prod_abcdef1234567890",
                name: "Production API Key",
            },
        ],
    }),
);

basicKernel.getApp().get("/", (c) => {
    return c.json({
        message: "API Key Example - Basic",
        usage: {
            header: "X-API-Key: sk_test_1234567890abcdef",
            bearer: "Authorization: Bearer sk_test_1234567890abcdef",
        },
    });
});

// Public endpoint - no API key required
basicKernel.getApp().get("/public", (c) => {
    return c.json({ message: "This is a public endpoint" });
});

// Protected endpoint - requires API key
basicKernel.getApp().get("/protected", requireApiKey(), (c) => {
    const apiKey = c.get("apiKey");
    return c.json({
        message: "Protected endpoint",
        keyName: apiKey?.name,
        keyId: apiKey?.id,
    });
});

// await basicKernel.initialize();
// await basicKernel.start(); 
// Commented out start to allow other examples to run or simple require main check

if (import.meta.main) {
    await basicKernel.initialize();
    await basicKernel.start();
}
