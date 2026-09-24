import { App } from '@iskra-bun/core';
import { ProcessManager } from '@iskra-bun/process-kit';
import { WebPlugin } from '@iskra-bun/web-kit';
import { config } from './app.config.ts';
import { Hono } from 'hono';

const app = new App({
    name: 'PythonDataProcessor',
    processes: config.processes
});

const pm = new ProcessManager();
app.register(pm);

// ─── Request-Response IPC ────────────────────────────────────────────────────

const pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: ReturnType<typeof setTimeout>;
}>();

function sendToProcess(processName: string, data: any, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Process request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timeout });

        pm.send(processName, { ...data, requestId });
    });
}

// Listen for messages from Python and resolve pending requests
app.on('process:message', (ctx) => {
    const { name, message } = ctx.payload;

    if (message.requestId && pendingRequests.has(message.requestId)) {
        const pending = pendingRequests.get(message.requestId)!;
        pendingRequests.delete(message.requestId);
        clearTimeout(pending.timeout);

        if (message.type === 'error') {
            pending.reject(new Error(message.msg || 'Process error'));
        } else {
            pending.resolve(message.data || message);
        }
        return;
    }

    app.logger.info({ msg: 'Received from process', name, message });
});

app.on('process:error', (ctx) => {
    const { name, text } = ctx.payload;
    app.logger.error({ msg: 'Process error', name, text });
});

// ─── HTTP Routes ─────────────────────────────────────────────────────────────

const router = new Hono();

router.post('/process', async (c) => {
    const body = await c.req.json();

    try {
        const result = await sendToProcess('processor', body);
        return c.json({ success: true, result });
    } catch (err: any) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

router.get('/health', (c) => {
    return c.json({ status: 'ok', pendingRequests: pendingRequests.size });
});

app.register(new WebPlugin({
    port: config.web.port,
    router: router
}));

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
