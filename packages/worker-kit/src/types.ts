export interface WorkerManagerOptions {
    /** URL de conexión a Redis (ej: 'redis://user:pass@localhost:6379/0'; `rediss://` activa TLS) */
    connection: string | { host: string; port: number; username?: string; password?: string; db?: number; tls?: object };
    /**
     * `false` = solo productor: `start()` no crea un Worker y `enqueue` acepta
     * jobs sin handler local (los procesa otro proceso). Default: true.
     */
    consume?: boolean;
    /** Cantidad de jobs que se procesan en paralelo (default: 1). `0` = solo productor, como `consume: false`. */
    concurrency?: number;
    /** Nombre de la queue en Redis (default: 'iskra-jobs') */
    queueName?: string;
    /** Opciones por defecto para cada job */
    defaultJobOptions?: JobOptions;
    /**
     * Activa el ruteo a dead-letter: cuando un job agota todos sus reintentos
     * se emite el evento `worker:dead-letter` en el bus de eventos de la App.
     * Opt-in para no cambiar el comportamiento existente (default: false).
     */
    deadLetter?: boolean;
}

/**
 * Especificación de repetición para jobs programados.
 *
 * - Un string se interpreta como un patrón cron (ej: '0 0 * * *').
 * - `{ every: ms }` repite cada `ms` milisegundos.
 * - `{ pattern: cron }` repite según el patrón cron, con opciones extra.
 */
export type RepeatSpec =
    | string
    | { every: number; limit?: number }
    | { pattern: string; limit?: number; tz?: string };

export interface JobOptions {
    /** Reintentos en caso de fallo */
    attempts?: number;
    /** Delay antes de procesar el job (ms) */
    delay?: number;
    /** Prioridad (menor = mayor prioridad) */
    priority?: number;
    /** Estrategia de backoff entre reintentos */
    backoff?: {
        type: 'fixed' | 'exponential';
        delay: number;
    };
    /** Eliminar el job de Redis al completarse */
    removeOnComplete?: boolean | number;
    /** Eliminar el job de Redis al fallar */
    removeOnFail?: boolean | number;
    /**
     * Programa el job como repetible (cron o intervalo).
     * Se reenvía a la opción `repeat` de BullMQ.
     */
    repeat?: RepeatSpec;
}

/**
 * Handler de un job. Puede devolver un valor `R` que queda disponible como
 * resultado del job (recuperable vía `job.waitUntilFinished`). Devolver `void`
 * sigue siendo válido (R por defecto es `void`).
 */
export type JobHandler<T = unknown, R = void> = (job: {
    id: string;
    name: string;
    data: T;
    attemptsMade: number;
}) => Promise<R>;

/**
 * Payload del evento `worker:dead-letter`, emitido cuando un job agota todos
 * sus reintentos y `deadLetter` está activado.
 */
export interface DeadLetterPayload {
    jobId: string | undefined;
    name: string | undefined;
    data: unknown;
    failedReason: string | undefined;
    attemptsMade: number;
}

/**
 * Descriptor devuelto por `enqueue`/`schedule`. Además de los datos del job,
 * expone `result()` para esperar el valor de retorno del handler.
 */
export interface JobDescriptor<T = unknown, R = unknown> {
    id: string;
    name: string;
    data: T;
    /**
     * Espera a que el job termine y resuelve con el valor que devolvió el
     * handler. Lanza si el job falló. Requiere una conexión a Redis viva.
     */
    result(ttlMs?: number): Promise<R>;
}
