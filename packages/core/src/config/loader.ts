import { loadConfig } from 'c12';
import { AppConfigSchema } from './schema';
import type { AppConfig } from '../types';

export async function loadAppConfig(cwd: string = process.cwd()): Promise<AppConfig> {
    const { config } = await loadConfig<AppConfig>({
        name: 'app',
        configFile: 'app.config',
        cwd,
        dotenv: true
    });

    const validConfig = AppConfigSchema.parse(config || {});
    return validConfig as AppConfig;
}
