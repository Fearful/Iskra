import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';

const app = new App({ name: 'SimpleServer' });

app.register(new WebDriver({
    port: Number(process.env.PORT) || 3000,
    routes: [
        {
            method: 'GET',
            path: '/',
            handler: () => ({ message: 'Hello from Iskra Simple Server!' })
        }
    ]
}));

// A failed start (port in use, bad config) must exit non-zero, or a
// supervisor or container runtime sees a clean exit and does not restart it.
app.start().catch((err) => {
    app.logger.error({ err }, 'Failed to start');
    process.exit(1);
});
