import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../src/cli.ts';

describe('parseArgs', () => {
    test('parses a positional target dir', () => {
        const r = parseArgs(['mi-app']);
        expect(r.targetDir).toBe('mi-app');
        expect(r.template).toBeUndefined();
        expect(r.yes).toBe(false);
    });

    test('parses --template and --yes', () => {
        const r = parseArgs(['mi-app', '--template', 'simple-server', '--yes']);
        expect(r.targetDir).toBe('mi-app');
        expect(r.template).toBe('simple-server');
        expect(r.yes).toBe(true);
    });

    test('parses --template=value form and short flags', () => {
        const r = parseArgs(['app', '--template=starter-app', '-y']);
        expect(r.template).toBe('starter-app');
        expect(r.yes).toBe(true);
        expect(parseArgs(['-t', 'x', 'app']).template).toBe('x');
    });

    test('parses --help', () => {
        expect(parseArgs(['--help']).help).toBe(true);
        expect(parseArgs(['-h']).help).toBe(true);
    });

    test('only the first positional becomes the target dir', () => {
        const r = parseArgs(['first', 'second']);
        expect(r.targetDir).toBe('first');
    });
});
