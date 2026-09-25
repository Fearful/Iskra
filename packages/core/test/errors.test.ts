import { describe, it, expect } from 'bun:test';
import { IskraError, ConfigError, DriverError, PluginError, LifecycleError, ErrorCodes } from '../src/errors';

describe('Error Hierarchy', () => {
    describe('IskraError', () => {
        it('should create with message and code', () => {
            const err = new IskraError('test error', { code: ErrorCodes.INTERNAL_ERROR });
            expect(err.message).toBe('test error');
            expect(err.code).toBe('INTERNAL_ERROR');
            expect(err.name).toBe('IskraError');
            expect(err.context).toEqual({});
        });

        it('should support cause chaining', () => {
            const cause = new Error('root cause');
            const err = new IskraError('wrapper', { code: ErrorCodes.INTERNAL_ERROR, cause });
            expect(err.cause).toBe(cause);
        });

        it('should include context metadata', () => {
            const err = new IskraError('with context', {
                code: ErrorCodes.INTERNAL_ERROR,
                context: { userId: 123, action: 'create' },
            });
            expect(err.context.userId).toBe(123);
            expect(err.context.action).toBe('create');
        });

        it('should serialize to JSON', () => {
            const cause = new Error('underlying');
            const err = new IskraError('json test', {
                code: ErrorCodes.INTERNAL_ERROR,
                cause,
                context: { key: 'value' },
            });

            const json = err.toJSON();
            expect(json.name).toBe('IskraError');
            expect(json.message).toBe('json test');
            expect(json.code).toBe('INTERNAL_ERROR');
            expect(json.context.key).toBe('value');
            expect(json.cause).toBe('underlying');
        });

        it('should serialize to JSON without cause', () => {
            const err = new IskraError('no cause', { code: ErrorCodes.INTERNAL_ERROR });
            const json = err.toJSON();
            expect(json.cause).toBeUndefined();
        });

        it('should be instanceof Error', () => {
            const err = new IskraError('test', { code: ErrorCodes.INTERNAL_ERROR });
            expect(err instanceof Error).toBe(true);
            expect(err instanceof IskraError).toBe(true);
        });
    });

    describe('ConfigError', () => {
        it('should have CONFIG_INVALID code by default', () => {
            const err = new ConfigError('bad config');
            expect(err.name).toBe('ConfigError');
            expect(err.code).toBe('CONFIG_INVALID');
            expect(err instanceof IskraError).toBe(true);
        });

        it('should support cause and context', () => {
            const cause = new Error('parse failed');
            const err = new ConfigError('invalid yaml', { cause, context: { file: 'app.config.ts' } });
            expect(err.cause).toBe(cause);
            expect(err.context.file).toBe('app.config.ts');
        });
    });

    describe('DriverError', () => {
        it('should have DRIVER_INIT_FAILED code by default', () => {
            const err = new DriverError('init failed');
            expect(err.name).toBe('DriverError');
            expect(err.code).toBe('DRIVER_INIT_FAILED');
        });

        it('should accept custom code', () => {
            const err = new DriverError('start failed', { code: ErrorCodes.DRIVER_START_FAILED });
            expect(err.code).toBe('DRIVER_START_FAILED');
        });
    });

    describe('PluginError', () => {
        it('should have PLUGIN_INSTALL_FAILED code', () => {
            const err = new PluginError('install failed');
            expect(err.name).toBe('PluginError');
            expect(err.code).toBe('PLUGIN_INSTALL_FAILED');
        });
    });

    describe('LifecycleError', () => {
        it('should store failures array', () => {
            const failures: PromiseRejectedResult[] = [
                { status: 'rejected', reason: new Error('driver1 failed') },
                { status: 'rejected', reason: new Error('driver2 failed') },
            ];

            const err = new LifecycleError('stop failed', {
                failures,
                context: { driverCount: 3, failedCount: 2 },
            });

            expect(err.name).toBe('LifecycleError');
            expect(err.code).toBe('LIFECYCLE_STOP_FAILED');
            expect(err.failures.length).toBe(2);
            expect(err.context.failedCount).toBe(2);
        });
    });

    describe('ErrorCodes', () => {
        it('should contain all expected codes', () => {
            expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
            expect(ErrorCodes.CONFIG_INVALID).toBe('CONFIG_INVALID');
            expect(ErrorCodes.DRIVER_INIT_FAILED).toBe('DRIVER_INIT_FAILED');
            expect(ErrorCodes.DRIVER_START_FAILED).toBe('DRIVER_START_FAILED');
            expect(ErrorCodes.DRIVER_STOP_FAILED).toBe('DRIVER_STOP_FAILED');
            expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
            expect(ErrorCodes.NOT_FOUND).toBe('NOT_FOUND');
            expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
            expect(ErrorCodes.DATABASE_ERROR).toBe('DATABASE_ERROR');
            expect(ErrorCodes.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
            expect(ErrorCodes.QUEUE_ERROR).toBe('QUEUE_ERROR');
            expect(ErrorCodes.JOB_ERROR).toBe('JOB_ERROR');
            expect(ErrorCodes.SOCKET_CONNECTION_ERROR).toBe('SOCKET_CONNECTION_ERROR');
        });
    });
});
