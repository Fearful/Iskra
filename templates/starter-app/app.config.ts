import { defineConfig } from '@iskra-bun/core';

// Helper if I haven't exported defineConfig yet, but I should have. 
// Wait, I forgot to export `defineConfig` in core, but I can use type or just object.
// Actually `c12` loads the default export.
// I'll add `defineConfig` to core later or just use type helper. 
// For now, simple export default object with type safety.

import type { AppConfig } from '@iskra-bun/core';

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
