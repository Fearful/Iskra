import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Creates a temporary directory, invokes `fn` with its path, and always
 * removes it afterwards — even when `fn` throws.
 *
 * Usage:
 *   await withTempDir(async (dir) => {
 *       await Bun.write(join(dir, 'file.txt'), 'hello');
 *       // dir is cleaned up automatically on return or throw
 *   });
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'iskra-test-'));
    try {
        return await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
