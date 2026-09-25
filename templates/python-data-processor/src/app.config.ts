import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
        /** Cuerpo mas grande que acepta /process, en bytes. */
        maxBodyBytes: z
            .number()
            .int()
            .positive()
            .default(256 * 1024),
    }),
    processor: z.object({
        /** Pedidos enviados a Python sin respuesta todavia; despues, 503. */
        maxInFlight: z.number().int().positive().default(8),
        /** Cuanto espera un pedido HTTP, en ms; despues, 504. */
        timeoutMs: z.number().int().positive().default(30_000),
    }),
    processes: z.record(
        z.object({
            command: z.string(),
            args: z.array(z.string()).optional(),
            mode: z.enum(['daemon', 'oneshot', 'stdio']).default('stdio'),
            restartOnCrash: z.boolean().optional(),
            maxRestarts: z.number().int().positive().optional(),
            restartBackoff: z.object({ initialMs: z.number().optional(), maxMs: z.number().optional() }).optional(),
        }),
    ),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = {
    web: {
        port: Number(process.env.PORT) || 3000,
        maxBodyBytes: 256 * 1024,
    },
    processor: {
        maxInFlight: Number(process.env.MAX_IN_FLIGHT) || 8,
        timeoutMs: Number(process.env.PROCESS_TIMEOUT_MS) || 30_000,
    },
    processes: {
        processor: {
            command: 'python3',
            args: ['src/scripts/process.py'],
            mode: 'stdio',
            // Si Python se cae, process-kit lo vuelve a levantar (con espera
            // creciente); antes el servicio quedaba sin procesador para siempre.
            restartOnCrash: true,
            maxRestarts: 10,
            restartBackoff: { initialMs: 1000, maxMs: 30_000 },
        },
    },
};
