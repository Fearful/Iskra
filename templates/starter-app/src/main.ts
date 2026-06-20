import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { ProcessManager } from '@iskra-bun/process-kit';
import { httpRouter } from './interfaces/http/router';

const app = new App();

// Register Web Driver
app.register(new WebDriver({
    port: 3000,
    routes: httpRouter
}));

// Register Process Manager
app.register(new ProcessManager());

// Listen to process events for debugging
app.on('process:log', (ctx) => {
    ctx.logger.info(`[${ctx.payload.name}] LOG: ${ctx.payload.text}`);
});

app.start().catch(console.error);
