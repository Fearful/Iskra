import mitt, { type Emitter } from 'mitt';
import { createLogger, type Logger } from './logger';
import { loadAppConfig } from './config/loader';
import type { AppConfig, Driver, Plugin, Context } from './types';
import { LifecycleError } from './errors';
import { initOtel, shutdownOtel } from './otel';

export class App {
    public config: AppConfig;
    public logger: Logger;
    public events: Emitter<any>;
    private drivers: Driver[] = [];
    public context: Map<string, any> = new Map();

    constructor(config?: AppConfig) {
        this.events = mitt();
        // Temporary config until init() is called (or passed in constructor)
        this.config = config || { name: 'Bootstrapping', logger: { level: 'info' } } as AppConfig;
        this.logger = createLogger(this.config.name, this.config.logger?.level);
    }

    async init() {
        // If config was not passed, load it
        if (this.config.name === 'Bootstrapping') {
            this.config = await loadAppConfig();
            this.logger = createLogger(this.config.name, this.config.logger?.level);
        }

        // Initialize OpenTelemetry SDK before drivers (so auto-instrumentation patches libraries)
        if (this.config.otel && this.config.otel.enabled !== false) {
            await initOtel(this.config.otel, this.config.name);
            this.logger.info({ endpoint: this.config.otel.endpoint }, 'OpenTelemetry initialized');
        }

        this.logger.info('Initializing App...');

        for (const driver of this.drivers) {
            if (driver.init) {
                this.logger.debug(`Initializing driver: ${driver.name}`);
                await driver.init(this);
            }
        }
    }

    register(driver: Driver) {
        this.drivers.push(driver);
        return this;
    }

    use(plugin: Plugin) {
        plugin.install(this);
        return this;
    }

    on(event: string, handler: (ctx: Context) => Promise<void> | void) {
        this.events.on(event, async (payload) => {
            const ctx: Context = {
                app: this,
                logger: this.logger.child({ event }),
                payload,
                reply: (data) => this.events.emit(`${event}:reply`, data)
            };

            try {
                await handler(ctx);
            } catch (err) {
                this.logger.error({ err, event }, 'Error handling event');
            }
        });
        return this;
    }

    emit(event: string, payload: any) {
        this.events.emit(event, payload);
    }

    async start() {
        await this.init();
        this.logger.info('Starting drivers...');
        await Promise.all(this.drivers.map(d => d.start ? d.start() : Promise.resolve()));
        this.logger.info('App started successfully 🚀');
    }

    async stop() {
        this.logger.info('Stopping app...');
        const results = await Promise.allSettled(this.drivers.map(d => d.stop ? d.stop() : Promise.resolve()));

        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failures.length > 0) {
            this.logger.error({ failures }, 'Some drivers failed to stop');
            throw new LifecycleError('Some drivers failed to stop', {
                failures,
                context: { driverCount: this.drivers.length, failedCount: failures.length },
            });
        }

        // Shutdown OTel SDK after drivers (flush pending spans/metrics)
        await shutdownOtel();

        this.logger.info('App stopped.');
    }
}
