import pino from 'pino';

export const createLogger = (name: string, level: string = 'info') => {
    const isDev = process.env.NODE_ENV !== 'production';
    return pino({
        name,
        level,
        redact: {
            paths: [
                'password',
                '*.password',
                'pass',
                '*.pass',
                'apiKey',
                '*.apiKey',
                '*.apiSecret',
                'token',
                '*.token',
                '*.authToken',
                'secret',
                '*.secret',
                'config.env',
                '*.data'
            ],
            censor: '[REDACTED]'
        },
        ...(isDev && {
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true
                }
            }
        })
    });
};

export type Logger = pino.Logger;
