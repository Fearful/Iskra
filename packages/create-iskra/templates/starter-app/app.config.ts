import type { AppConfig } from '@iskra-bun/core';

// Typed application config. `new App()` (src/main.ts) loads it from the working
// directory at startup; run the app from this directory.

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
