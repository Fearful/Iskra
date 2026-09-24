import pino from 'pino';
import pretty from 'pino-pretty';

export const createLogger = (name: string, level: string = 'info') => {
    const isDev = process.env.NODE_ENV !== 'production';
    const options: pino.LoggerOptions = {
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
    };
    // pino-pretty as an in-process stream, not a `transport`: a transport runs
    // in a worker thread that loads the module by name at runtime, which fails
    // in a `bun build --compile` binary and crashed it at startup.
    return isDev ? pino(options, pretty({ colorize: true })) : pino(options);
};

export type Logger = pino.Logger;
