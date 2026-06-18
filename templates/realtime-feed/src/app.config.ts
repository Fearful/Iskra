import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
    }),
    socket: z.object({
        port: z.number().default(3001),
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = {
    web: {
        port: Number(process.env.PORT) || 3000,
    },
    socket: {
        port: Number(process.env.SOCKET_PORT) || 3001,
    }
};
