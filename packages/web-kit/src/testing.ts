/**
 * `@iskra-bun/web-kit/testing`: the app as WebPlugin builds it, without a
 * port, for tests that call it with `request()`.
 */
import type { Hono } from 'hono';
import { mountRoutes } from './driver';
import type { Router } from './group-router';
import { Kernel } from './kernel';
import type { Feature, KernelConfig } from './types';

export interface TestKernelOptions extends KernelConfig {
    /** The app's routes, as WebPlugin's `router`. */
    router?: Router | Hono;
    features?: Feature[];
}

export interface TestKernel {
    /** The Kernel's Hono app, with the features' middleware and the routes. */
    app: Hono;
    kernel: Kernel;
    /** `app.request()`: a request to the app, no server involved. */
    request: Hono['request'];
    /** Shuts the features down (a db, a cache…). */
    close(): Promise<void>;
}

/**
 * The Kernel WebPlugin would run (features initialized, then the routes
 * mounted with the same code), with `logger: false` unless given:
 *
 * ```ts
 * const { request, close } = await createTestKernel({ router, features: [new ErrorHandlerFeature()] });
 * const res = await request('/api/users/1', { headers: { Authorization: 'Bearer …' } });
 * ```
 */
export async function createTestKernel(options: TestKernelOptions = {}): Promise<TestKernel> {
    const { router, features = [], ...config } = options;
    const kernel = new Kernel({ logger: false, ...config });
    for (const feature of features) kernel.registerFeature(feature);
    await kernel.initialize();
    mountRoutes(kernel, router);
    const app = kernel.getApp();
    return { app, kernel, request: app.request.bind(app) as Hono['request'], close: () => kernel.shutdown() };
}
