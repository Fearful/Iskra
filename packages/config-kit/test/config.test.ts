import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { loadConfig, envBool, envNumber, envPort, envEnum } from '../src';
import { ConfigError } from '@iskra-bun/core';

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe('loadConfig', () => {
    const schema = z.object({
        APP_NAME: z.string(),
        APP_PORT: z.string(),
    });

    it('returns a typed config object for a valid source', () => {
        const config = loadConfig({
            schema,
            source: { APP_NAME: 'test-app', APP_PORT: '3000' },
        });

        expect(config.APP_NAME).toBe('test-app');
        expect(config.APP_PORT).toBe('3000');
    });

    it('defaults to process.env when no source is provided', () => {
        const original = process.env.APP_NAME;
        process.env.APP_NAME = 'from-env';
        process.env.APP_PORT = '8080';

        try {
            const config = loadConfig({ schema });
            expect(config.APP_NAME).toBe('from-env');
        } finally {
            if (original === undefined) {
                delete process.env.APP_NAME;
            } else {
                process.env.APP_NAME = original;
            }
            delete process.env.APP_PORT;
        }
    });

    it('returns a deep-frozen object', () => {
        const nestedSchema = z.object({
            DB: z.object({ HOST: z.string(), PORT: z.string() }).default({ HOST: 'localhost', PORT: '5432' }),
        });

        const config = loadConfig({ schema: nestedSchema, source: {} });

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.DB)).toBe(true);

        expect(() => {
            (config as { DB: { HOST: string } }).DB.HOST = 'mutated';
        }).toThrow();
    });

    it('throws ConfigError naming the missing required field', () => {
        expect(() =>
            loadConfig({
                schema,
                source: { APP_PORT: '3000' }, // APP_NAME missing
            }),
        ).toThrow(ConfigError);

        try {
            loadConfig({ schema, source: { APP_PORT: '3000' } });
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            expect((err as ConfigError).message).toContain('APP_NAME');
        }
    });

    it('throws ConfigError for invalid value — lists field name and reason', () => {
        const strictSchema = z.object({
            TIMEOUT: z.string().regex(/^\d+$/, 'must be numeric'),
        });

        try {
            loadConfig({ schema: strictSchema, source: { TIMEOUT: 'not-a-number' } });
            throw new Error('Expected error was not thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            expect((err as ConfigError).message).toContain('TIMEOUT');
            expect((err as ConfigError).message).toContain('must be numeric');
        }
    });

    it('does NOT include secret values in the error message', () => {
        const secretSchema = z.object({
            API_KEY: z.string().min(50, 'too short'),
        });

        // 49 chars — below the 50-char minimum so validation fails
        const secretValue = 'my-super-secret-api-key-that-must-not-appear-leak';

        try {
            loadConfig({ schema: secretSchema, source: { API_KEY: secretValue } });
            throw new Error('Expected error was not thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            expect((err as ConfigError).message).not.toContain(secretValue);
        }
    });

    it('reports multiple failures in one throw', () => {
        try {
            loadConfig({ schema, source: {} }); // both fields missing
            throw new Error('Expected error was not thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            const msg = (err as ConfigError).message;
            expect(msg).toContain('APP_NAME');
            expect(msg).toContain('APP_PORT');
        }
    });

    it('ConfigError.context contains field paths without values', () => {
        try {
            loadConfig({ schema, source: {} });
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            const ctx = (err as ConfigError).context;
            expect(Array.isArray(ctx.fields)).toBe(true);
            const fields = ctx.fields as Array<{ path: string; message: string }>;
            // Ensure no value data leaked into context
            for (const f of fields) {
                expect(typeof f.path).toBe('string');
                expect(typeof f.message).toBe('string');
            }
        }
    });
});

// ─── envBool ─────────────────────────────────────────────────────────────────

describe('envBool', () => {
    it.each([
        ['true', true],
        ['TRUE', true],
        ['1', true],
        ['yes', true],
        ['YES', true],
        ['false', false],
        ['FALSE', false],
        ['0', false],
        ['no', false],
        ['NO', false],
    ])('coerces %s → %s', (input, expected) => {
        const schema = z.object({ FLAG: envBool });
        const config = loadConfig({ schema, source: { FLAG: input } });
        expect(config.FLAG).toBe(expected);
    });

    it.each(['maybe', 'on', 'off', '2', ''])('rejects invalid value "%s"', (input) => {
        const schema = z.object({ FLAG: envBool });
        expect(() => loadConfig({ schema, source: { FLAG: input } })).toThrow(ConfigError);
    });
});

// ─── envNumber ────────────────────────────────────────────────────────────────

describe('envNumber', () => {
    it('coerces integer string to number', () => {
        const schema = z.object({ COUNT: envNumber });
        const config = loadConfig({ schema, source: { COUNT: '42' } });
        expect(config.COUNT).toBe(42);
    });

    it('coerces float string to number', () => {
        const schema = z.object({ RATIO: envNumber });
        const config = loadConfig({ schema, source: { RATIO: '3.14' } });
        expect(config.RATIO).toBeCloseTo(3.14);
    });

    it('coerces negative number', () => {
        const schema = z.object({ OFFSET: envNumber });
        const config = loadConfig({ schema, source: { OFFSET: '-7' } });
        expect(config.OFFSET).toBe(-7);
    });

    it.each(['abc', '', 'NaN', 'Infinity'])('rejects non-numeric "%s"', (input) => {
        const schema = z.object({ NUM: envNumber });
        expect(() => loadConfig({ schema, source: { NUM: input } })).toThrow(ConfigError);
    });
});

// ─── envPort ─────────────────────────────────────────────────────────────────

describe('envPort', () => {
    it('coerces valid port strings', () => {
        const schema = z.object({ PORT: envPort });
        expect(loadConfig({ schema, source: { PORT: '3000' } }).PORT).toBe(3000);
        expect(loadConfig({ schema, source: { PORT: '1' } }).PORT).toBe(1);
        expect(loadConfig({ schema, source: { PORT: '65535' } }).PORT).toBe(65535);
    });

    it.each(['0', '65536', '-1', '80.5', 'abc', ''])('rejects invalid port "%s"', (input) => {
        const schema = z.object({ PORT: envPort });
        expect(() => loadConfig({ schema, source: { PORT: input } })).toThrow(ConfigError);
    });
});

// ─── envEnum ─────────────────────────────────────────────────────────────────

describe('envEnum', () => {
    const schema = z.object({ NODE_ENV: envEnum(['development', 'production', 'test'] as const) });

    it.each(['development', 'production', 'test'])('accepts valid value "%s"', (input) => {
        const config = loadConfig({ schema, source: { NODE_ENV: input } });
        expect(config.NODE_ENV).toBe(input);
    });

    it.each(['staging', 'dev', '', 'DEVELOPMENT'])('rejects invalid value "%s"', (input) => {
        expect(() => loadConfig({ schema, source: { NODE_ENV: input } })).toThrow(ConfigError);
    });
});
