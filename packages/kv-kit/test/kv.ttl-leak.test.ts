/**
 * Tests for TTL timer leak fix in MemoryAdapter.
 *
 * Verifies that:
 * - Overwriting a key with a new TTL does NOT let the old timer delete the new value
 * - Overwriting a key with no TTL cancels the old timer
 * - Deleting a key cancels its timer
 * - disconnect() clears all timers without leaving dangling handles
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryAdapter } from '../src/adapters/memory';

describe('MemoryAdapter — TTL timer leak fix', () => {
    let adapter: MemoryAdapter;

    beforeEach(() => {
        adapter = new MemoryAdapter();
        adapter.connect();
    });

    it('overwriting a key with a NEW TTL does not let the old timer delete the fresh value', async () => {
        // Set with 100 ms TTL
        await adapter.set('k', 'first', 0.1);
        // Immediately overwrite with 10 s TTL — old 100 ms timer must be cancelled
        await adapter.set('k', 'second', 10);

        // Wait past the original timer's deadline
        await new Promise((r) => setTimeout(r, 150));

        const val = await adapter.get<string>('k');
        expect(val).toBe('second');
    });

    it('overwriting a key with NO TTL cancels the old timer', async () => {
        await adapter.set('k', 'first', 0.1); // 100 ms TTL
        await adapter.set('k', 'permanent'); // no TTL — must clear old timer

        await new Promise((r) => setTimeout(r, 150));

        const val = await adapter.get<string>('k');
        expect(val).toBe('permanent');
    });

    it('deleting a key cancels its pending timer', async () => {
        await adapter.set('k', 'value', 0.5); // 500 ms TTL
        await adapter.del('k');

        // Value is gone immediately
        expect(await adapter.get('k')).toBeUndefined();

        // No error / crash from the timer firing after del
        await new Promise((r) => setTimeout(r, 600));
        expect(await adapter.get('k')).toBeUndefined();
    });

    it('disconnect() clears all pending timers without throwing', async () => {
        await adapter.set('a', 1, 10);
        await adapter.set('b', 2, 10);
        await adapter.set('c', 3, 10);

        // Should clear store and timers without error
        adapter.disconnect();

        expect(await adapter.get('a')).toBeUndefined();
        expect(await adapter.get('b')).toBeUndefined();
        expect(await adapter.get('c')).toBeUndefined();
    });

    it('timer fires at the correct time after a re-set', async () => {
        await adapter.set('k', 'value', 0.1); // 100 ms — will be overwritten
        await adapter.set('k', 'value2', 0.15); // 150 ms

        // Still alive at 120 ms (old timer would have fired here)
        await new Promise((r) => setTimeout(r, 120));
        expect(await adapter.get<string>('k')).toBe('value2');

        // Gone after 160 ms (new timer fires at ~150 ms)
        await new Promise((r) => setTimeout(r, 50));
        expect(await adapter.get('k')).toBeUndefined();
    });
});
