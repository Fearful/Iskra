export interface WorkerManagerOptions {
    /** URL de conexión a Redis (ej: 'redis://localhost:6379') */
    connection: string | { host: string; port: number; password?: string; db?: number };
    /** Cantidad de jobs que se procesan en paralelo (default: 1) */
    concurrency?: number;
    /** Nombre de la queue en Redis (default: 'iskra-jobs') */
    queueName?: string;
    /** Opciones por defecto para cada job */
    defaultJobOptions?: JobOptions;
}

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
}

export interface JobData {
    [key: string]: any;
}

export type JobHandler = (job: { id: string; name: string; data: any; attemptsMade: number }) => Promise<void>;
