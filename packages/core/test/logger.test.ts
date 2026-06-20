import { describe, it, expect, afterEach } from 'bun:test';
import pino from 'pino';
import { createLogger } from '../src/logger';

// pino exposes its internal symbols for testing purposes
const { streamSym } = (pino as any).symbols as { streamSym: symbol };

// Captures the raw JSON line pino serializes by intercepting the stream's
// `write`. Redaction is applied during serialization (asJson), BEFORE the line
// reaches the stream/transport, so this captures the censored output for both
// the dev (pino-pretty worker) and prod (stdout) branches.
const captureLog = (
    logger: pino.Logger,
    emit: (l: pino.Logger) => void
): string => {
    const stream = (logger as any)[streamSym] as { write: (s: string) => boolean };
    const original = stream.write.bind(stream);
    let captured = '';
    stream.write = (s: string) => {
        captured += s;
        return true;
    };
    try {
        emit(logger);
    } finally {
        stream.write = original;
    }
    return captured;
};

describe('createLogger', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('includes pino-pretty transport in development (stream is not stdout)', () => {
        process.env.NODE_ENV = 'development';
        const logger = createLogger('test-dev');
        const stream = (logger as any)[streamSym];
        // pino-pretty runs in a worker thread; the stream is a SonicBoom or worker-backed
        // writable — NOT the raw process.stdout fd-1 object.
        expect(stream).not.toBe(process.stdout);
    });

    it('omits transport in production (stream is stdout)', () => {
        process.env.NODE_ENV = 'production';
        const logger = createLogger('test-prod');
        const stream = (logger as any)[streamSym];
        // Without a custom transport, pino defaults its stream to process.stdout.
        expect(stream).toBeDefined();
        // The underlying fd should be 1 (stdout)
        expect((stream as any).fd).toBe(1);
    });

    it('preserves name and level on the logger', () => {
        process.env.NODE_ENV = 'production';
        const logger = createLogger('my-app', 'warn');
        expect(logger.level).toBe('warn');
    });

    // HIGH finding: pino must be configured with a `redact` that censors
    // secret-bearing paths to '[REDACTED]'. The same redaction must apply in
    // BOTH the dev and prod branches.
    describe.each(['development', 'production'])('secret redaction in %s', (env) => {
        const buildSecretPayload = () => ({
            password: 'top-secret',
            pass: 'pw',
            apiKey: 'ak-123',
            token: 'tok-123',
            secret: 'shh',
            nested: {
                password: 'np',
                pass: 'npass',
                apiKey: 'nak',
                apiSecret: 'nas',
                token: 'ntok',
                authToken: 'nauth',
                secret: 'nsecret',
                data: 'sensitive-data'
            },
            config: {
                env: { DB_URL: 'postgres://secret' }
            },
            keep: 'visible-value'
        });

        const emitAndCapture = (): { json: string; parsed: any } => {
            process.env.NODE_ENV = env;
            const logger = createLogger(`redact-${env}`);
            const json = captureLog(logger, (l) =>
                l.info(buildSecretPayload(), 'secret message')
            );
            return { json, parsed: JSON.parse(json) };
        };

        it('censors top-level secret fields to [REDACTED]', () => {
            const { parsed } = emitAndCapture();
            expect(parsed.password).toBe('[REDACTED]');
            expect(parsed.pass).toBe('[REDACTED]');
            expect(parsed.apiKey).toBe('[REDACTED]');
            expect(parsed.token).toBe('[REDACTED]');
            expect(parsed.secret).toBe('[REDACTED]');
        });

        it('censors nested secret fields via wildcard paths', () => {
            const { parsed } = emitAndCapture();
            expect(parsed.nested.password).toBe('[REDACTED]');
            expect(parsed.nested.pass).toBe('[REDACTED]');
            expect(parsed.nested.apiKey).toBe('[REDACTED]');
            expect(parsed.nested.apiSecret).toBe('[REDACTED]');
            expect(parsed.nested.token).toBe('[REDACTED]');
            expect(parsed.nested.authToken).toBe('[REDACTED]');
            expect(parsed.nested.secret).toBe('[REDACTED]');
            expect(parsed.nested.data).toBe('[REDACTED]');
        });

        it('censors config.env and wildcard *.data paths', () => {
            const { parsed } = emitAndCapture();
            expect(parsed.config.env).toBe('[REDACTED]');
        });

        it('leaves non-secret fields untouched', () => {
            const { parsed } = emitAndCapture();
            expect(parsed.keep).toBe('visible-value');
            expect(parsed.msg).toBe('secret message');
        });

        it('never leaks raw secret values into the serialized line', () => {
            const { json } = emitAndCapture();
            for (const secret of [
                'top-secret',
                'ak-123',
                'tok-123',
                'shh',
                'sensitive-data',
                'postgres://secret',
                'nauth'
            ]) {
                expect(json).not.toContain(secret);
            }
        });
    });
});
