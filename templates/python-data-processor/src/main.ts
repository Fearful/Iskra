import { App } from '@iskra-bun/core';
import { ProcessManager } from '@iskra-bun/process-kit';
import { WebPlugin } from '@iskra-bun/web-kit';
import { config } from './app.config.ts';
import { createProcessor } from './processor.ts';

const app = new App({
    name: 'PythonDataProcessor',
    processes: config.processes,
});

const pm = new ProcessManager();
app.register(pm);

// Request-response con el proceso Python y rutas HTTP (ver src/processor.ts).
const { router } = createProcessor(app, pm, config.processor);

app.register(
    new WebPlugin({
        port: config.web.port,
        // Cada cuerpo viaja entero a Python y vuelve en la respuesta: process-kit
        // lee lineas de hasta 1 MiB, asi que el pedido tiene que ser bastante menor.
        maxRequestBodySize: config.web.maxBodyBytes,
        router: router,
    }),
);

async function main() {
    await app.start();
    console.log('Python Data Processor started');
}

// Exit 1 on a failed start (e.g. the database is unreachable): with only
// console.error the process exited 0, which restart policies read as success.
main().catch((err) => {
    console.error('Could not start Python Data Processor:', err);
    process.exit(1);
});
