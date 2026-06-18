/**
 * Metricas en memoria del worker. Sirven para el endpoint de monitoring.
 *
 * Nota: son metricas por-instancia (no compartidas entre replicas). Para una
 * vista agregada del cluster, las stats reales viven en Redis y se exponen
 * via `WorkerManager` / BullMQ; ver `src/http/monitoring.ts`.
 */
export interface Metrics {
    readonly enqueued: number;
    readonly completed: number;
    readonly failed: number;
    readonly retried: number;
    readonly deadLettered: number;
    readonly startedAt: number;
}

const initial: Metrics = {
    enqueued: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    deadLettered: 0,
    startedAt: Date.now(),
};

let state: Metrics = initial;

type Counter = Exclude<keyof Metrics, 'startedAt'>;

/** Incrementa un contador creando un nuevo objeto de estado (sin mutar). */
export function increment(counter: Counter, by = 1): Metrics {
    state = { ...state, [counter]: state[counter] + by };
    return state;
}

/** Devuelve una copia del estado actual mas datos derivados. */
export function snapshot() {
    const uptimeSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
    return {
        ...state,
        uptimeSeconds,
    };
}
