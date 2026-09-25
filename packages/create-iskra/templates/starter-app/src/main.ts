import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { ProcessManager } from '@iskra-bun/process-kit';
import { httpRouter } from './interfaces/http/router';

// Without a config, init() loads app.config.ts from the working directory.
const app = new App();

// Register Web Driver
app.register(
    new WebDriver({
        port: Number(process.env.PORT) || 3000,
        routes: httpRouter,
    }),
);

// Register Process Manager
app.register(new ProcessManager());

// Listen to process events for debugging
app.on('process:log', (ctx) => {
    ctx.logger.info(`[${ctx.payload.name}] LOG: ${ctx.payload.text}`);
});

// A failed start (port in use, bad config) must exit non-zero, or a
// supervisor or container runtime sees a clean exit and does not restart it.
app.start().catch((err) => {
    app.logger.error({ err }, 'Failed to start');
    process.exit(1);
});
