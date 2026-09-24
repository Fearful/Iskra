import { describe, expect, test } from 'bun:test';
import { pinManifest, resolveWorkspaceRange } from './pin-workspace-deps';

describe('resolveWorkspaceRange', () => {
    test('follows the bun/pnpm publish rules', () => {
        expect(resolveWorkspaceRange('workspace:*', '0.2.0')).toBe('0.2.0');
        expect(resolveWorkspaceRange('workspace:^', '0.2.0')).toBe('^0.2.0');
        expect(resolveWorkspaceRange('workspace:~', '0.2.0')).toBe('~0.2.0');
        expect(resolveWorkspaceRange('workspace:^0.1.0', '0.2.0')).toBe('^0.1.0');
    });
});

describe('pinManifest', () => {
    const versions = new Map([
        ['@iskra-bun/core', '0.1.1'],
        ['@iskra-bun/kv-kit', '0.2.0'],
    ]);

    test('rewrites workspace ranges in every dependency field and leaves others alone', () => {
        const pinned = pinManifest(
            {
                name: '@iskra-bun/cache-kit',
                version: '0.1.0',
                dependencies: { '@iskra-bun/core': 'workspace:*', zod: '^3.22.0' },
                peerDependencies: { '@iskra-bun/kv-kit': 'workspace:^' },
                devDependencies: { '@iskra-bun/core': 'workspace:*' },
            },
            versions,
        );
        expect(pinned.dependencies).toEqual({ '@iskra-bun/core': '0.1.1', zod: '^3.22.0' });
        expect(pinned.peerDependencies).toEqual({ '@iskra-bun/kv-kit': '^0.2.0' });
        expect(pinned.devDependencies).toEqual({ '@iskra-bun/core': '0.1.1' });
    });

    test('does not mutate its input', () => {
        const manifest = { name: 'x', dependencies: { '@iskra-bun/core': 'workspace:*' } };
        pinManifest(manifest, versions);
        expect(manifest.dependencies['@iskra-bun/core']).toBe('workspace:*');
    });

    test('fails loudly when a workspace dependency does not exist', () => {
        expect(() => pinManifest({ name: 'x', dependencies: { '@iskra-bun/nope': 'workspace:*' } }, versions)).toThrow(
            /no workspace package named @iskra-bun\/nope/,
        );
    });
});
