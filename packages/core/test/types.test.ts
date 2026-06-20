import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// LOW finding: RestartBackoffConfig declares initialMs/maxMs/factor as required,
// but their JSDoc documents defaults and the consumer reads them as
// `?.x ?? default`. They should be optional. bun:test does not typecheck, so we
// drive `tsc --noEmit` over a fixture that omits those fields; it must compile
// once the fields are made optional.
describe('RestartBackoffConfig typing', () => {
    it('allows omitting the documented-default fields', () => {
        const tsc = resolve(import.meta.dir, '../../../node_modules/.bin/tsc');
        const fixture = resolve(
            import.meta.dir,
            'fixtures/restart-backoff-optional.ts'
        );
        const result = spawnSync(
            tsc,
            [
                '--noEmit',
                '--strict',
                '--moduleResolution',
                'bundler',
                '--module',
                'ESNext',
                '--target',
                'ESNext',
                '--skipLibCheck',
                fixture
            ],
            { encoding: 'utf8' }
        );

        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        expect(output).not.toContain('TS2739');
        expect(result.status).toBe(0);
    });
});
