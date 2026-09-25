import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAppConfig } from '../src/config/loader';

const tmpDirs: string[] = [];

function makeConfigDir(contents?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'iskra-cfg-'));
    tmpDirs.push(dir);
    if (contents !== undefined) {
        writeFileSync(join(dir, 'app.config.ts'), contents);
    }
    return dir;
}

afterEach(() => {
    while (tmpDirs.length) {
        const dir = tmpDirs.pop()!;
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    }
});

describe('loadAppConfig', () => {
    it('returns schema defaults when no config file is present', async () => {
        const config = await loadAppConfig(makeConfigDir());

        expect(config.name).toBe('IskraApp');
        expect(config.debug).toBe(false);
        expect(config.logger?.level).toBe('info');
    });

    it('loads and validates values from app.config.ts', async () => {
        const dir = makeConfigDir(`export default { name: 'MyApp', debug: true, logger: { level: 'debug' } };`);
        const config = await loadAppConfig(dir);

        expect(config.name).toBe('MyApp');
        expect(config.debug).toBe(true);
        expect(config.logger?.level).toBe('debug');
    });

    it('applies defaults for fields omitted in the config file', async () => {
        const dir = makeConfigDir(`export default { name: 'PartialApp' };`);
        const config = await loadAppConfig(dir);

        expect(config.name).toBe('PartialApp');
        expect(config.debug).toBe(false);
        expect(config.logger?.level).toBe('info');
    });

    it('parses and defaults nested otel config', async () => {
        const dir = makeConfigDir(`export default { name: 'OtelApp', otel: { endpoint: 'http://collector:4318' } };`);
        const config = await loadAppConfig(dir);

        expect(config.otel?.endpoint).toBe('http://collector:4318');
        expect(config.otel?.enabled).toBe(true);
        expect(config.otel?.serviceVersion).toBe('0.1.0');
    });

    it('keeps the kit sections and custom keys from app.config.ts', async () => {
        // Regression: the schema was a plain z.object(), which strips unknown
        // keys, so db/kv/socket (and restart settings) never reached the kits.
        const dir = makeConfigDir(`export default {
            name: 'KitsApp',
            db: { driver: 'sqlite', url: 'data.db' },
            kv: { driver: 'redis', connection: { url: 'redis://cache:6379' } },
            socket: { enabled: true, port: 3001 },
            processes: {
                worker: { command: 'python3', maxRestarts: 3, restartCooldown: 500, restartBackoff: { initialMs: 100 } },
            },
            payments: { provider: 'stripe' },
        };`);
        const config = await loadAppConfig(dir);

        expect(config.db).toEqual({ driver: 'sqlite', url: 'data.db' });
        expect(config.kv).toEqual({ driver: 'redis', connection: { url: 'redis://cache:6379' } });
        expect(config.socket).toEqual({ enabled: true, port: 3001 });
        expect(config.processes?.worker).toMatchObject({
            maxRestarts: 3,
            restartCooldown: 500,
            restartBackoff: { initialMs: 100 },
        });
        expect(config.payments).toEqual({ provider: 'stripe' });
    });

    it('rejects a malformed kit section instead of dropping it', async () => {
        const dir = makeConfigDir(`export default { db: { driver: 'oracle', url: 'x' } };`);
        await expect(loadAppConfig(dir)).rejects.toThrow();
    });

    it('validates the environment and stdin options of a process', async () => {
        const dir = makeConfigDir(`export default {
            processes: { etl: { command: 'python3', inheritEnv: ['DATABASE_URL'], maxPendingStdinBytes: 1024 } },
        };`);
        const config = await loadAppConfig(dir);
        expect(config.processes?.etl).toMatchObject({ inheritEnv: ['DATABASE_URL'], maxPendingStdinBytes: 1024 });

        const env = makeConfigDir(
            `export default { processes: { etl: { command: 'x', inheritEnv: 'DATABASE_URL' } } };`,
        );
        await expect(loadAppConfig(env)).rejects.toThrow();
        const max = makeConfigDir(`export default { processes: { etl: { command: 'x', maxPendingStdinBytes: 0 } } };`);
        await expect(loadAppConfig(max)).rejects.toThrow();
    });
});

describe('loadAppConfig and the working directory', () => {
    it('ignores a .apprc file', async () => {
        const dir = makeConfigDir(`export default { name: 'FromAppConfig' };`);
        writeFileSync(join(dir, '.apprc'), 'shutdownSignals=false\nprocesses.miner.command=/bin/sh\n');

        const config = await loadAppConfig(dir);

        expect(config.name).toBe('FromAppConfig');
        expect(config.processes).toBeUndefined();
        expect(config.shutdownSignals).toBeUndefined();
    });

    it('does not download remote `extends` layers', async () => {
        let requests = 0;
        const server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch() {
                requests++;
                return new Response('not a tarball', { status: 404 });
            },
        });
        const warn = console.warn;
        console.warn = () => {};
        try {
            const dir = makeConfigDir(
                `export default { name: 'Main', extends: ['http://127.0.0.1:${server.port}/layer.tar.gz'] };`,
            );
            const config = await loadAppConfig(dir);

            expect(config.name).toBe('Main');
            expect(requests).toBe(0);
        } finally {
            console.warn = warn;
            server.stop(true);
        }
    });

    it('still merges a local `extends` layer', async () => {
        const dir = makeConfigDir(`export default { name: 'Main', extends: ['./base'] };`);
        mkdirSync(join(dir, 'base'));
        writeFileSync(join(dir, 'base', 'app.config.ts'), `export default { debug: true };`);

        const config = await loadAppConfig(dir);

        expect(config.name).toBe('Main');
        expect(config.debug).toBe(true);
    });
});
