import type { Feature, CorsConfig } from '../types';
import type { Kernel } from '../kernel';
import { cors } from 'hono/cors';
import { consoleLogger, type KernelLogger } from '../logging';

export class CorsFeature implements Feature {
    name = 'cors';
    private log: KernelLogger = consoleLogger;

    constructor(private config: CorsConfig = {}) {
        if (!this.config.origin) {
            this.config.origin = '*';
        }
        if (this.config.credentials === undefined) {
            this.config.credentials = false;
        }
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const app = kernel.getApp();

        // Hono's cors() wants the allowed origin back (or null), not a boolean.
        const { origin, ...rest } = this.config;
        const honoConfig: Parameters<typeof cors>[0] = {
            ...rest,
            origin: typeof origin === 'function' ? (o: string) => (origin(o) ? o : null) : (origin ?? '*'),
        };

        app.use('*', cors(honoConfig));
        this.log.debug('CORS feature initialized');
    }
}
