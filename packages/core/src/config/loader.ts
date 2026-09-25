import { loadConfig } from 'c12';
import { AppConfigSchema } from './schema';
import type { AppConfig } from '../types';

export async function loadAppConfig(cwd: string = process.cwd()): Promise<AppConfig> {
    const { config } = await loadConfig<AppConfig>({
        name: 'app',
        configFile: 'app.config',
        cwd,
        dotenv: true,
        // c12 would also merge a `.apprc` file from the working directory (a
        // plain key=value file that could add `processes` to spawn or move
        // `otel.endpoint`), and download and run `extends` layers from
        // github:/gitlab:/https:// sources on every start. Local `extends`
        // paths still work.
        rcFile: false,
        giget: false,
    });

    const validConfig = AppConfigSchema.parse(config || {});
    return validConfig as AppConfig;
}
