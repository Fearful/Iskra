import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';

const app = new App({ name: 'SimpleServer' });

app.register(new WebDriver({
    port: 3000,
    routes: [
        {
            method: 'GET',
            path: '/',
            handler: () => ({ message: 'Hello from Iskra Simple Server!' })
        }
    ]
}));

app.start().catch(console.error);
