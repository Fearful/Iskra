/**
 * Request-response sobre el proceso Python (JSON por stdin/stdout) y las rutas
 * HTTP que lo exponen.
 *
 * Hay un solo proceso y atiende de a un pedido, asi que todo esta acotado:
 *   - a lo sumo `maxInFlight` pedidos enviados sin respuesta (503 si no hay lugar);
 *   - un pedido que vence (504) sigue ocupando su lugar hasta que Python lo
 *     contesta: la cola de Python no se achica porque el cliente se haya ido.
 *     Con el `deadline` que viaja en cada pedido, Python descarta los vencidos
 *     sin procesarlos;
 *   - si el proceso termina, los pedidos pendientes fallan en el acto (antes
 *     esperaban el timeout) y /process responde 503 hasta que el proceso
 *     reiniciado avisa que esta listo.
 */

import type { App } from '@iskra-bun/core';
import { Hono } from 'hono';

/** El nombre del proceso en app.config.ts. */
export const PROCESS_NAME = 'processor';

export interface ProcessorOptions {
    /** Pedidos enviados a Python sin respuesta todavia (los vencidos incluidos). Default 8. */
    maxInFlight?: number;
    /** Cuanto espera el cliente HTTP una respuesta, en ms. Default 30000. */
    timeoutMs?: number;
}

/** Lo que este modulo usa del ProcessManager. */
export interface ProcessSender {
    /** `false` (o una promesa de `false`): el mensaje no se envio. */
    send(name: string, data: unknown): unknown;
}

/** What process.py prints: replies carry the requestId they answer. */
interface ProcessReply {
    requestId?: string;
    type?: string;
    msg?: string;
    data?: unknown;
}

// Any JSON line the script prints arrives here: check its shape before use.
function asReply(message: unknown): ProcessReply {
    return typeof message === 'object' && message !== null ? (message as ProcessReply) : {};
}

class ProcessorError extends Error {
    constructor(
        message: string,
        readonly status: 502 | 503 | 504,
    ) {
        super(message);
    }
}

interface Pending {
    resolve(value: unknown): void;
    reject(reason: ProcessorError): void;
    timeout: ReturnType<typeof setTimeout>;
    /** El cliente HTTP ya recibio respuesta (timeout); Python todavia no. */
    settled: boolean;
}

export function createProcessor(app: App, processes: ProcessSender, options: ProcessorOptions = {}) {
    const maxInFlight = options.maxInFlight ?? 8;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const inFlight = new Map<string, Pending>();
    // process.py avisa con {"type":"status"} al arrancar; hasta entonces no hay a quien mandarle.
    let ready = false;

    function sendToProcess(data: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const pending: Pending = {
                resolve,
                reject,
                settled: false,
                timeout: setTimeout(() => {
                    // El lugar sigue ocupado hasta que Python conteste o termine.
                    pending.settled = true;
                    reject(new ProcessorError(`Process request timed out after ${timeoutMs}ms`, 504));
                }, timeoutMs),
            };
            inFlight.set(requestId, pending);

            // process-kit resuelve false si no lo envio (el proceso no corre, o
            // no leyo lo que ya se le mando): el pedido fallaba recien al vencer.
            const refused = () => {
                if (inFlight.get(requestId) !== pending) return;
                inFlight.delete(requestId);
                clearTimeout(pending.timeout);
                if (!pending.settled) reject(new ProcessorError('The processor is busy', 503));
            };
            Promise.resolve(
                processes.send(PROCESS_NAME, { ...data, requestId, deadline: Date.now() + timeoutMs }),
            ).then((sent) => {
                if (sent === false) refused();
            }, refused);
        });
    }

    // Listen for messages from Python and resolve pending requests
    app.on('process:message', (ctx) => {
        if (ctx.payload.name !== PROCESS_NAME) return;
        const message = asReply(ctx.payload.message);

        const pending = message.requestId ? inFlight.get(message.requestId) : undefined;
        if (message.requestId && pending) {
            inFlight.delete(message.requestId);
            clearTimeout(pending.timeout);
            if (pending.settled) return;
            if (message.type === 'error') {
                // El detalle (un str() de la excepcion de Python) queda en el log.
                app.logger.warn({ requestId: message.requestId, error: message.msg }, 'The processor failed');
                pending.reject(new ProcessorError('Processing failed', 502));
            } else {
                pending.resolve(message.data || message);
            }
            return;
        }

        if (message.type === 'status') ready = true;
        app.logger.info({ msg: 'Received from process', name: ctx.payload.name, message });
    });

    // Sin proceso nadie va a contestar: los pendientes fallan ya, no al vencer.
    app.on('process:exit', (ctx) => {
        if (ctx.payload.name !== PROCESS_NAME) return;
        ready = false;
        for (const pending of inFlight.values()) {
            clearTimeout(pending.timeout);
            if (!pending.settled) pending.reject(new ProcessorError('The processor exited', 503));
        }
        inFlight.clear();
    });

    app.on('process:error', (ctx) => {
        const { name, text } = ctx.payload;
        app.logger.error({ msg: 'Process error', name, text });
    });

    const router = new Hono();

    router.post('/process', async (c) => {
        // Solo JSON: cualquier Content-Type se parseaba como JSON.
        if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
            return c.json({ success: false, error: 'Content-Type must be application/json' }, 415);
        }
        let body: unknown;
        try {
            body = await c.req.json();
        } catch {
            return c.json({ success: false, error: 'Invalid JSON body' }, 400);
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return c.json({ success: false, error: 'The body must be a JSON object' }, 400);
        }
        if (!ready) {
            c.header('Retry-After', '1');
            return c.json({ success: false, error: 'The processor is not running' }, 503);
        }
        if (inFlight.size >= maxInFlight) {
            c.header('Retry-After', '1');
            return c.json({ success: false, error: 'Too many requests in flight' }, 503);
        }

        try {
            const result = await sendToProcess(body as Record<string, unknown>);
            return c.json({ success: true, result });
        } catch (err) {
            if (err instanceof ProcessorError) {
                if (err.status === 503) c.header('Retry-After', '1');
                return c.json({ success: false, error: err.message }, err.status);
            }
            throw err;
        }
    });

    router.get('/health', (c) => {
        return c.json({ status: 'ok', ready, pendingRequests: inFlight.size });
    });

    return { router, inFlight: () => inFlight.size };
}
