import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
        const dir = makeConfigDir(
            `export default { name: 'MyApp', debug: true, logger: { level: 'debug' } };`,
        );
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
        const dir = makeConfigDir(
            `export default { name: 'OtelApp', otel: { endpoint: 'http://collector:4318' } };`,
        );
        const config = await loadAppConfig(dir);

        expect(config.otel?.endpoint).toBe('http://collector:4318');
        expect(config.otel?.enabled).toBe(true);
        expect(config.otel?.serviceVersion).toBe('0.1.0');
    });
});
