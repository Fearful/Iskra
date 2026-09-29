import { describe, expect, it } from 'bun:test';
import { ConfigError } from '@iskra-bun/core';
import { env, envBool, envEnum, envNumber, envPort, fromEnv } from '../src/index';

const spec = {
    host: 'DB_HOST_ORACLE',
    port: env('DB_PORT_ORACLE', envPort, { default: 1521 }),
    serviceName: env(['DB_SERVICE_ORACLE', 'ORA_SERVICE']),
    user: 'DB_USER_ORACLE',
    password: 'DB_PASS_ORACLE',
    pool: { max: env('DB_POOL_MAX', envNumber, { default: 4 }) },
    debug: env('DB_DEBUG', envBool, { optional: true }),
} as const;

describe('fromEnv()', () => {
    it("reads a section from the service's own variable names, converted and with defaults", () => {
        const config = fromEnv(spec, {
            source: {
                DB_HOST_ORACLE: 'db.intranet',
                ORA_SERVICE: 'CORE',
                DB_USER_ORACLE: 'core',
                DB_PASS_ORACLE: 's3cret',
                DB_POOL_MAX: '10',
            },
        });
        expect(config).toEqual({
            host: 'db.intranet',
            port: 1521,
            serviceName: 'CORE',
            user: 'core',
            password: 's3cret',
            pool: { max: 10 },
        });
        // Typed from the spec.
        const port: number = config.port;
        const debug: boolean | undefined = config.debug;
        expect([port, debug]).toEqual([1521, undefined]);
    });

    it('takes the first variable that is set, an empty one counting as unset', () => {
        const config = fromEnv(
            { service: env(['NEW_NAME', 'LEGACY_NAME']) },
            { source: { NEW_NAME: '', LEGACY_NAME: 'legacy' } },
        );
        expect(config.service).toBe('legacy');
    });

    it('reports every problem at once, naming the variables but never their values', () => {
        const error = (() => {
            try {
                fromEnv(spec, { source: { DB_PORT_ORACLE: '99999', DB_POOL_MAX: 'many', DB_PASS_ORACLE: 'hunter2' } });
            } catch (e) {
                return e as ConfigError;
            }
        })()!;
        expect(error).toBeInstanceOf(ConfigError);
        expect(error.message).toContain('DB_HOST_ORACLE is not set');
        expect(error.message).toContain('DB_SERVICE_ORACLE or ORA_SERVICE is not set');
        expect(error.message).toContain('DB_PORT_ORACLE: Expected a port number');
        expect(error.message).toContain('DB_POOL_MAX: Expected a finite number');
        expect(error.message).not.toContain('99999');
        expect(error.message).not.toContain('hunter2');
    });

    it('checks one of a set of values', () => {
        const read = (value: string) =>
            fromEnv({ mode: env('MODE', envEnum(['thin', 'thick'])) }, { source: { MODE: value } });
        expect(read('thin').mode).toBe('thin');
        expect(() => read('other')).toThrow('MODE: Expected one of');
    });
});
