import { describe, it, expect, afterEach } from 'bun:test';
import pino from 'pino';
import { createLogger } from '../src/logger';

// pino exposes its internal symbols for testing purposes
const { streamSym } = (pino as any).symbols as { streamSym: symbol };

// Captures the raw JSON line pino serializes by intercepting the stream's
// `write`. Redaction is applied during serialization (asJson), BEFORE the line
// reaches the stream/transport, so this captures the censored output for both
// the dev (pino-pretty worker) and prod (stdout) branches.
const captureLog = (logger: pino.Logger, emit: (l: pino.Logger) => void): string => {
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
                data: 'sensitive-data',
            },
            config: {
                env: { DB_URL: 'postgres://secret' },
            },
            keep: 'visible-value',
        });

        const emitAndCapture = (): { json: string; parsed: any } => {
            process.env.NODE_ENV = env;
            const logger = createLogger(`redact-${env}`);
            const json = captureLog(logger, (l) => l.info(buildSecretPayload(), 'secret message'));
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
                'nauth',
            ]) {
                expect(json).not.toContain(secret);
            }
        });
    });

    describe('secrets at any depth', () => {
        it("censors nested and top-level secret keys without touching the caller's object", () => {
            process.env.NODE_ENV = 'production';
            const logger = createLogger('redact-deep');
            const config = {
                name: 'x',
                db: { driver: 'libsql', url: 'libsql://db.turso.io', authToken: 'TURSO-SECRET' },
                kv: { connection: { host: 'h', password: 'REDIS-SECRET' } },
                list: [{ clientSecret: 'LIST-SECRET' }],
                a: { b: { c: { d: { privateKey: 'DEEP-SECRET' } } } },
            };
            const json = captureLog(logger, (l) => {
                l.info({ config }, 'Config loaded');
                l.info({ authToken: 'TOP-AUTHTOKEN', apiSecret: 'TOP-APISECRET', Authorization: 'Bearer X' }, 'top');
            });
            for (const secret of [
                'TURSO-SECRET',
                'REDIS-SECRET',
                'LIST-SECRET',
                'DEEP-SECRET',
                'TOP-AUTHTOKEN',
                'TOP-APISECRET',
                'Bearer X',
            ]) {
                expect(json).not.toContain(secret);
            }
            expect(json).toContain('"host":"h"');
            expect(config.db.authToken).toBe('TURSO-SECRET');
        });

        it('handles circular objects', () => {
            process.env.NODE_ENV = 'production';
            const logger = createLogger('redact-cycle');
            const obj: Record<string, unknown> = { password: 'CYCLE-SECRET' };
            obj.self = obj;
            const json = captureLog(logger, (l) => l.info({ obj }, 'cycle'));
            expect(json).not.toContain('CYCLE-SECRET');
        });
    });
});

describe('redaction of what the key list missed', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    const lines = (emit: (l: pino.Logger) => void): any[] => {
        process.env.NODE_ENV = 'production';
        const logger = createLogger('redact-gaps');
        return captureLog(logger, emit)
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
    };

    it("scrubs an error's own fields, e.g. an HTTP client's Authorization header", () => {
        class AxiosError extends Error {
            config = { url: 'https://api.sendgrid.com/v3/mail/send', headers: { Authorization: 'Bearer SG.LIVE-KEY' } };
            code = 'ECONNRESET';
        }
        const [viaKey, direct] = lines((l) => {
            l.error({ err: new AxiosError('socket hang up') }, 'send failed');
            l.error(new AxiosError('socket hang up'));
        });

        for (const entry of [viaKey, direct]) {
            expect(entry.err.type).toBe('AxiosError');
            expect(entry.err.message).toBe('socket hang up');
            expect(entry.err.code).toBe('ECONNRESET');
            expect(entry.err.config.headers.Authorization).toBe('[REDACTED]');
            expect(typeof entry.err.stack).toBe('string');
        }
        expect(JSON.stringify([viaKey, direct])).not.toContain('SG.LIVE-KEY');
    });

    it("scrubs the client objects an error keeps (axios's AxiosHeaders and request)", () => {
        class AxiosHeaders {
            constructor(private readonly headers: Record<string, string>) {}
            toJSON() {
                return { ...this.headers };
            }
        }
        class RedirectableRequest {
            _options = { headers: { Authorization: 'Bearer SG.IN-REQUEST', Accept: 'application/json' } };
        }
        const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
            isAxiosError: true,
            config: { headers: new AxiosHeaders({ Authorization: 'Bearer SG.IN-CONFIG' }) },
            request: new RedirectableRequest(),
        });
        const [entry] = lines((l) => l.error({ err, at: new Date(0) }, 'send failed'));

        expect(entry.err.config.headers.Authorization).toBe('[REDACTED]');
        expect(entry.err.request._options.headers.Authorization).toBe('[REDACTED]');
        expect(entry.err.request._options.headers.Accept).toBe('application/json');
        expect(entry.at).toBe('1970-01-01T00:00:00.000Z');
        expect(JSON.stringify(entry)).not.toContain('SG.IN-');
    });

    it('scrubs errors inside other fields and error causes', () => {
        const inner = Object.assign(new Error('auth failed'), { password: 'INNER-PW' });
        const outer = new Error('driver failed', { cause: inner });
        const [entry] = lines((l) => l.error({ failures: [{ status: 'rejected', reason: inner }], err: outer }, 'x'));

        expect(entry.failures[0].reason.password).toBe('[REDACTED]');
        expect(entry.err.message).toContain('auth failed');
        expect(JSON.stringify(entry)).not.toContain('INNER-PW');
    });

    it('masks connection-string passwords and secret query parameters in messages', () => {
        const [fromError, fromString] = lines((l) => {
            l.error(new Error('connect ECONNREFUSED postgres://app:S3CRET-DB@db:5432/app'));
            l.info('libsql URL libsql://db.turso.io?authToken=TURSO-TOKEN&tls=1 is not valid');
        });

        expect(fromError.msg).toBe('connect ECONNREFUSED postgres://app:[REDACTED]@db:5432/app');
        expect(fromError.err.message).toBe(fromError.msg);
        expect(fromError.err.stack).not.toContain('S3CRET-DB');
        expect(fromString.msg).toBe('libsql URL libsql://db.turso.io?authToken=[REDACTED]&tls=1 is not valid');
    });

    it('scrubs child logger bindings, at every generation', () => {
        const [child, grandchild] = lines((l) => {
            const c = l.child({
                password: 'CHILD-PW',
                headers: { authorization: 'Bearer CHILD-AUTH' },
                requestId: 'r1',
            });
            c.info('child');
            c.child({ apiKey: 'GRANDCHILD-KEY' }).info('grandchild');
        });

        expect(child.password).toBe('[REDACTED]');
        expect(child.headers.authorization).toBe('[REDACTED]');
        expect(child.requestId).toBe('r1');
        expect(grandchild.apiKey).toBe('[REDACTED]');
        expect(grandchild.password).toBe('[REDACTED]');
    });

    it('matches other spellings of the secret keys, and keys ending in one', () => {
        const [entry] = lines((l) =>
            l.info(
                {
                    headers: {
                        'x-api-key': 'K1',
                        'set-cookie': 'sid=K2',
                        'proxy-authorization': 'Basic K3',
                        'x-auth-token': 'K4',
                    },
                    api_key: 'K5',
                    client_secret: 'K6',
                    access_token: 'K7',
                    DB_PASSWORD: 'K8',
                    AWS_SECRET_ACCESS_KEY: 'K9',
                    webhookSecret: 'K10',
                    sessionId: 'K11',
                    tokenCount: 3,
                    passwordPolicy: 'strong',
                    host: 'db',
                },
                'config',
            ),
        );

        for (const secret of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11']) {
            expect(JSON.stringify(entry)).not.toContain(`"${secret}"`);
        }
        expect(entry.tokenCount).toBe(3);
        expect(entry.passwordPolicy).toBe('strong');
        expect(entry.host).toBe('db');
    });

    it('stays fast on long, hostile messages', () => {
        const started = performance.now();
        lines((l) => {
            l.info('?' + 'key'.repeat(50_000));
            l.info('a://' + 'b'.repeat(100_000));
            l.info('&' + 'x-'.repeat(50_000) + '=v');
        });
        expect(performance.now() - started).toBeLessThan(500);
    });
});
