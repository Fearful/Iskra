import { describe, it, expect, mock } from 'bun:test';
import { ApiKeyStore } from '../src/features/api-key';
import type { Kernel } from '../src/kernel';
import type { ApiKeyMetadata } from '../src/types';

// RED test for a MEDIUM api-key finding (the cache it also covered is gone):
//   Metadata mutation (src/features/api-key.ts:94): metadata.lastUsedAt =
//      new Date() mutates the object held in staticKeysMap. The fix must build
//      a derived object { ...metadata, lastUsedAt } and leave the stored one
//      untouched.

describe('ApiKeyStore — metadata immutability', () => {
    it('does not mutate the stored metadata object on validate', async () => {
        const mockKernel: any = { getFeature: mock(() => undefined) };
        const staticKey = {
            id: 'key-imm',
            key: 'another-secret-key',
            name: 'Immutable Key',
            scopes: ['read'],
            createdAt: new Date(),
        };
        const store = new ApiKeyStore(
            { staticKeys: [staticKey], enableCache: false } as any,
            mockKernel as unknown as Kernel,
        );

        const result = await store.validate(staticKey.key);
        expect(result.isValid).toBe(true);

        // Validate again and capture the second result. If validation mutates the
        // shared stored object, the first result's lastUsedAt would be advanced by
        // the second call. With a derived object, the stored metadata stays at the
        // initial `undefined` lastUsedAt and is never mutated in place.
        const firstSnapshot = JSON.stringify(result.key);
        await store.validate(staticKey.key);

        // The stored metadata held in staticKeysMap must be unchanged — it should
        // still have lastUsedAt === undefined (it was never mutated).
        const stored = (store as any).staticKeysMap.get(staticKey.key) as ApiKeyMetadata;
        expect(stored.lastUsedAt).toBeUndefined();

        // And the first returned object must not have been mutated by the second
        // validate call.
        expect(JSON.stringify(result.key)).toBe(firstSnapshot);
    });
});
