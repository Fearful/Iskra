import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
    }),
    processes: z.record(z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
        mode: z.enum(['daemon', 'oneshot', 'stdio']).default('stdio'),
    })),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = {
    web: {
        port: Number(process.env.PORT) || 3000,
    },
    processes: {
        processor: {
            command: 'python3',
            args: ['src/scripts/process.py'],
            mode: 'stdio',
        },
    },
};
