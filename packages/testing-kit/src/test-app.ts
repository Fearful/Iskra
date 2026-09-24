import { App } from '@iskra-bun/core';
import type { AppConfig } from '@iskra-bun/core';
import type { Logger } from '@iskra-bun/core';
import { createMockLogger } from './mock-logger';

/**
 * Creates a real App instance configured for testing:
 * - Logger level defaults to 'error' so tests stay silent
 * - OTel is disabled to avoid side effects
 * - Config name defaults to 'TestApp'
 * - Accepts optional overrides merged shallowly over the defaults
 *
 * The returned app is a genuine App so start()/stop()/register() all work
 * exactly as in production.
 *
 * Usage:
 *   const app = createTestApp();
 *   app.register(myDriver);
 *   await app.start();
 *   await app.stop();
 */
export function createTestApp(overrides?: Partial<AppConfig>): App {
    const config: AppConfig = {
        name: 'TestApp',
        logger: { level: 'error' },
        ...overrides,
    };

    const app = new App(config);

    // Replace the pino logger with a mock logger so tests produce no output
    // and can assert on logged messages when needed.
    app.logger = createMockLogger() as unknown as Logger;

    return app;
}
