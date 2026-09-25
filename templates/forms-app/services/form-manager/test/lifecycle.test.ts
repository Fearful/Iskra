import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REDIS_KEYS } from '@forms-app/shared';

const staticDir = mkdtempSync(join(tmpdir(), 'form-manager-static-'));
process.env.STATIC_DIR = staticDir;
const { LifecycleService } = await import('../src/domain/lifecycle/lifecycle.service.ts');

afterAll(() => rmSync(staticDir, { recursive: true, force: true }));

describe('LifecycleService.removeForm', () => {
    it("deletes the form's Redis keys, index entry and static page", async () => {
        const deleted: string[] = [];
        const removed: string[] = [];
        LifecycleService.setRedis({
            del: async (...keys: string[]) => void deleted.push(...keys),
            srem: async (_set: string, member: string) => void removed.push(member),
        });
        mkdirSync(join(staticDir, 'space', 'form'), { recursive: true });
        writeFileSync(join(staticDir, 'space', 'form', 'index.html'), '<html></html>');
        const log = console.log;
        console.log = () => {};
        try {
            await LifecycleService.removeForm('space', 'form');
        } finally {
            console.log = log;
        }
        // Left in place, they kept forms-api accepting answers for a deleted form.
        expect(deleted).toEqual([REDIS_KEYS.formSchema('space', 'form'), REDIS_KEYS.formMeta('space', 'form')]);
        expect(removed).toEqual(['space:form']);
        expect(existsSync(join(staticDir, 'space', 'form'))).toBe(false);
        expect(existsSync(join(staticDir, 'space'))).toBe(true);
    });

    it('refuses slugs that are not slugs', async () => {
        await expect(LifecycleService.removeForm('..', 'x')).rejects.toThrow(/Invalid slug/);
        await expect(LifecycleService.removeForm('space', '../..')).rejects.toThrow(/Invalid slug/);
    });
});
