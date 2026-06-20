import pino from 'pino';

export const createLogger = (name: string, level: string = 'info') => {
    const isDev = process.env.NODE_ENV !== 'production';
    return pino({
        name,
        level,
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
