import mitt, { type Emitter } from 'mitt';
import { createLogger, type Logger } from './logger';
import { loadAppConfig } from './config/loader';
import type { AppConfig, Driver, Plugin, Context } from './types';
import { LifecycleError } from './errors';
import { initOtel, shutdownOtel } from './otel';

const DEFAULT_SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export class App {
    public config: AppConfig;
    public logger: Logger;
    public events: Emitter<any>;
    private drivers: Driver[] = [];
    /** Drivers whose start() succeeded, in start order; null until start() runs. */
    private startedDrivers: Driver[] | null = null;
    private pendingInstalls: PromiseLike<void>[] = [];
    /** The shutdown in progress, shared by concurrent stop() calls. */
    private stopping: Promise<void> | null = null;
    private signalHandler?: (signal: NodeJS.Signals) => void;
    private signals: NodeJS.Signals[] = [];
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

        // Async plugin installs are awaited here so a failure surfaces from
        // start() instead of crashing the process as an unhandled rejection.
        await Promise.all(this.pendingInstalls);
        this.pendingInstalls = [];

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
        const result = plugin.install(this);
        if (result && typeof (result as PromiseLike<void>).then === 'function') {
            const install = Promise.resolve(result);
            // Observed now so an early rejection is not reported as unhandled;
            // init() awaits the original promise and rethrows its error.
            install.catch(() => {});
            this.pendingInstalls.push(install);
        }
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

    /**
     * Starts drivers one at a time, in registration order, so a driver can rely
     * on the ones registered before it (e.g. the DB before the web server). If
     * one fails, the drivers already started are stopped in reverse order and
     * the error is rethrown, instead of leaving ports bound and children running.
     */
    async start() {
        await this.init();
        this.logger.info('Starting drivers...');
        const started: Driver[] = [];
        for (const driver of this.drivers) {
            try {
                if (driver.start) await driver.start();
                started.push(driver);
            } catch (err) {
                this.logger.error({ err, driver: driver.name }, 'Driver failed to start; stopping the drivers already started');
                await this.stopDrivers(started.reverse());
                this.startedDrivers = [];
                throw err;
            }
        }
        this.startedDrivers = started;
        this.installSignalHandlers();
        this.logger.info('App started successfully 🚀');
    }

    /**
     * Stops drivers in reverse start order (the web server before the DB it
     * uses), continuing past failures, and always flushes OpenTelemetry.
     *
     * A call made while a stop is in progress (e.g. an app's own signal
     * handler next to the App's) gets that same stop: it resolves only once
     * every driver has stopped, instead of right away with nothing left to do.
     */
    stop(): Promise<void> {
        this.stopping ??= this.stopOnce().finally(() => {
            this.stopping = null;
        });
        return this.stopping;
    }

    private async stopOnce() {
        this.logger.info('Stopping app...');
        const toStop = [...(this.startedDrivers ?? this.drivers)].reverse();
        this.startedDrivers = [];

        let failures: PromiseRejectedResult[];
        try {
            failures = await this.stopDrivers(toStop);
        } finally {
            // Shutdown OTel SDK after drivers (flush pending spans/metrics)
            await shutdownOtel();
            // Removed only now: while the drivers stop, a second signal must
            // still reach the handler (forced exit) instead of the default action.
            this.removeSignalHandlers();
        }

        if (failures.length > 0) {
            this.logger.error({ failures }, 'Some drivers failed to stop');
            throw new LifecycleError('Some drivers failed to stop', {
                failures,
                context: { driverCount: toStop.length, failedCount: failures.length },
            });
        }

        this.logger.info('App stopped.');
    }

    private async stopDrivers(drivers: Driver[]): Promise<PromiseRejectedResult[]> {
        const failures: PromiseRejectedResult[] = [];
        for (const driver of drivers) {
            try {
                if (driver.stop) await driver.stop();
            } catch (reason) {
                this.logger.error({ err: reason, driver: driver.name }, 'Driver failed to stop');
                failures.push({ status: 'rejected', reason });
            }
        }
        return failures;
    }

    /**
     * Stops the app gracefully on SIGTERM/SIGINT (configurable with
     * `shutdownSignals`, off by default under NODE_ENV=test). Once a listener
     * exists the runtime no longer exits on its own, so the handler exits with
     * 0 after a clean stop, or 1 on failure / after `shutdownTimeoutMs`. A
     * second signal forces exit.
     */
    private installSignalHandlers() {
        const configured = this.config.shutdownSignals;
        const signals = configured === false
            ? []
            : configured ?? (process.env.NODE_ENV === 'test' ? [] : DEFAULT_SHUTDOWN_SIGNALS);
        if (signals.length === 0 || this.signalHandler) return;

        const timeoutMs = this.config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
        let shuttingDown = false;
        this.signalHandler = (signal) => {
            if (shuttingDown) {
                this.logger.warn({ signal }, 'Second shutdown signal; exiting immediately');
                process.exit(1);
            }
            shuttingDown = true;
            this.logger.info({ signal }, 'Shutdown signal received; stopping app');
            const timer = setTimeout(() => {
                this.logger.error({ timeoutMs }, 'Graceful shutdown timed out; exiting');
                process.exit(1);
            }, timeoutMs);
            this.stop().then(
                () => {
                    clearTimeout(timer);
                    process.exit(0);
                },
                (err) => {
                    clearTimeout(timer);
                    this.logger.error({ err }, 'Graceful shutdown failed');
                    process.exit(1);
                },
            );
        };
        this.signals = signals as NodeJS.Signals[];
        for (const signal of this.signals) process.on(signal, this.signalHandler);
    }

    private removeSignalHandlers() {
        if (!this.signalHandler) return;
        for (const signal of this.signals) process.off(signal, this.signalHandler);
        this.signalHandler = undefined;
        this.signals = [];
    }
}
