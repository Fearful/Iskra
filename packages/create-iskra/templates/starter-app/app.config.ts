import type { AppConfig } from '@iskra-bun/core';

// Typed application config. Imported by `src/main.ts` and passed to `new App(config)`.

const config: AppConfig = {
    name: 'StarterApp',
    debug: true,
    logger: {
        level: 'debug'
    },
    processes: {
        'python-echo': {
            command: 'python3',
            args: ['src/external/scripts/echo.py'],
            mode: 'stdio' // We want to test communication
        }
    }
};

export default config;
