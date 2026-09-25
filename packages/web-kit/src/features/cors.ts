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
        // Browsers refuse credentials with `Access-Control-Allow-Origin: *`,
        // which this used to send without a word, and the usual way out is to
        // reflect any origin: every site could then read responses as the user.
        if (this.config.credentials && this.config.origin === '*') {
            throw new Error(
                "CorsFeature: `credentials: true` needs `origin` to name the allowed origins (a list or a function), not '*' or unset.",
            );
        }
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
