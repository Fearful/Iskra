import { z } from 'zod';

export const AppConfigSchema = z.object({
    app: z.object({
        name: z.string().default('Universal App'),
    }),
    /**
     * Fuerza la plataforma sin depender del host Tauri. Util para probar las
     * ramas desktop/mobile desde Node/Bun. Si es 'auto', se detecta en runtime.
     */
    forcePlatform: z.enum(['auto', 'desktop', 'mobile']).default('auto'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const config: AppConfig = AppConfigSchema.parse({
    app: {
        name: 'Iskra Universal App',
    },
    forcePlatform: process.env.FORCE_PLATFORM as 'auto' | 'desktop' | 'mobile' | undefined,
});
