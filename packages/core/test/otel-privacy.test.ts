import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { AppConfigSchema } from '../src/config/schema';
import { autoInstrumentationOptions, describeOtelEndpoint, redactUrl } from '../src/otel';

const HTTP = '@opentelemetry/instrumentation-http';

/** A recording SDK span as instrumentation-http hands it to requestHook. */
function sdkSpan(attributes: Record<string, unknown>) {
    return {
        attributes,
        setAttribute(key: string, value: unknown) {
            attributes[key] = value;
        },
    };
}

/** Runs fixtures/otel-app.ts (App.init() against fake OTel packages) and parses what it printed. */
async function runOtelApp(endpoint?: string): Promise<any> {
    const env: Record<string, string | undefined> = { ...process.env, OTEL_FIXTURE_ENDPOINT: endpoint };
    if (endpoint === undefined) delete env.OTEL_FIXTURE_ENDPOINT;
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', 'otel-app.ts')], {
        cwd: import.meta.dir,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) throw new Error(`otel fixture exited with ${code}: ${err}`);
    return JSON.parse(out.trim().split('\n').pop()!);
}

describe('redactUrl', () => {
    it('masks the values of secret-looking query parameters and keeps the rest', () => {
        expect(redactUrl('https://api.example.com/v1?api_key=K3Y&page=2&access_token=T0K#top')).toBe(
            'https://api.example.com/v1?api_key=REDACTED&page=2&access_token=REDACTED#top',
        );
        // Names are compared without case, `-` or `_`, also when percent-encoded.
        expect(redactUrl('/cb?Code=abc&STATE=xyz&apiKey=1&%74oken=2')).toBe(
            '/cb?Code=REDACTED&STATE=REDACTED&apiKey=REDACTED&%74oken=REDACTED',
        );
        expect(redactUrl('https://bucket.s3.amazonaws.com/f?X-Amz-Signature=abc&X-Amz-Date=1')).toBe(
            'https://bucket.s3.amazonaws.com/f?X-Amz-Signature=REDACTED&X-Amz-Date=1',
        );
        expect(redactUrl('https://example.com/search?q=tokens')).toBe('https://example.com/search?q=tokens');
        expect(redactUrl('/a?session=1', ['session'])).toBe('/a?session=REDACTED');
    });
});

describe('OpenTelemetry instrumentation options', () => {
    it('keeps the options of each instrumentation through the config schema', () => {
        // Regression: z.object({ enabled }) stripped every other key.
        const ignoreIncomingRequestHook = () => true;
        const config = AppConfigSchema.parse({
            otel: {
                instrumentations: {
                    [HTTP]: { enabled: true, ignoreIncomingRequestHook, redactedQueryParams: ['sid'] },
                },
            },
        });
        expect(config.otel?.instrumentations?.[HTTP]).toEqual({
            enabled: true,
            ignoreIncomingRequestHook,
            redactedQueryParams: ['sid'],
        });
    });

    it('redacts secret query parameters of HTTP spans by default', () => {
        const http = autoInstrumentationOptions({})[HTTP] as Record<string, any>;
        expect(http.redactedQueryParams).toContain('api_key');
        expect(http.redactedQueryParamsServer).toContain('token');

        // Releases before 0.204 ignore those options: the requestHook rewrites the span.
        const client = sdkSpan({ 'url.full': 'https://api.example.com/v1?api_key=K3Y&page=2' });
        http.requestHook(client, { setHeader() {} });
        expect(client.attributes['url.full']).toBe('https://api.example.com/v1?api_key=REDACTED&page=2');

        const server = sdkSpan({ 'http.target': '/verify?token=T0K', 'url.query': 'token=T0K&x=1' });
        http.requestHook(server, { headers: {} });
        expect(server.attributes).toEqual({
            'http.target': '/verify?token=REDACTED',
            'url.query': 'token=REDACTED&x=1',
        });
    });

    it('lets the app choose the parameters and keeps its own options and requestHook', () => {
        const calls: unknown[] = [];
        const options = autoInstrumentationOptions({
            instrumentations: {
                [HTTP]: {
                    redactedQueryParams: ['sid'],
                    ignoreIncomingRequestHook: () => true,
                    requestHook: (s) => calls.push(s),
                },
                '@opentelemetry/instrumentation-fs': { enabled: true },
            },
        });
        const http = options[HTTP] as Record<string, any>;
        expect(http.redactedQueryParams).toEqual(['sid']);
        expect(typeof http.ignoreIncomingRequestHook).toBe('function');
        expect(options['@opentelemetry/instrumentation-fs']).toEqual({ enabled: true });

        const span = sdkSpan({ 'url.full': 'https://x.test/?sid=1&token=2' });
        http.requestHook(span, { setHeader() {} });
        expect(span.attributes['url.full']).toBe('https://x.test/?sid=REDACTED&token=2');
        expect(calls).toEqual([span]);
    });
});

describe('OTLP endpoint', () => {
    it('describes the endpoint by its origin only', () => {
        const endpoint = 'https://user:pw@otlp.example.com:4318/v1?api-key=K3Y';
        expect(describeOtelEndpoint({ endpoint })).toEqual({
            origin: 'https://otlp.example.com:4318',
            plaintext: false,
        });
        expect(describeOtelEndpoint({}).origin).toBe('http://localhost:4318');
    });

    it('flags plain http:// only for a host outside this machine and its network', () => {
        const plaintext = (endpoint: string) => describeOtelEndpoint({ endpoint }).plaintext;
        expect(plaintext('http://otel.example.com:4318')).toBe(true);
        expect(plaintext('http://203.0.113.9:4318')).toBe(true);
        for (const local of [
            'http://localhost:4318',
            'http://127.0.0.1:4318',
            'http://[::1]:4318',
            'http://otel-collector:4318',
            'http://10.0.3.12:4318',
            'http://192.168.1.20:4318',
            'http://172.20.0.5:4318',
            'http://collector.observability.svc.cluster.local:4318',
            'https://otel.example.com',
        ]) {
            expect(plaintext(local)).toBe(false);
        }
    });

    it('logs the endpoint origin and warns about a remote plain-http one', async () => {
        const out = await runOtelApp('http://tenant:S3CRET@otel.example.com:4318/ingest/K3Y');

        expect(out.traceUrl).toBe('http://tenant:S3CRET@otel.example.com:4318/ingest/K3Y/v1/traces');
        const logged = JSON.stringify(out.logs);
        expect(logged).not.toContain('S3CRET');
        expect(logged).not.toContain('K3Y');
        expect(out.logs).toContainEqual({
            level: 'info',
            fields: { endpoint: 'http://otel.example.com:4318' },
            msg: 'OpenTelemetry initialized',
        });
        expect(out.logs.filter((l: any) => l.level === 'warn')).toHaveLength(1);

        // initOtel passed the app's HTTP options on, with the redaction defaults.
        expect(out.fsEnabled).toBe(false);
        expect(out.http.ignoreIncomingRequestHook).toBe('function');
        expect(out.http.redactedQueryParams).toContain('access_token');
        expect(out.spanAttributes).toEqual({
            'url.full': 'https://api.example.com/v1/items?api_key=REDACTED&page=2',
            'http.url': 'https://api.example.com/v1/items?access_token=REDACTED',
            'app.hook': 'ran',
        });
    }, 20000);

    it('does not warn about the default local collector', async () => {
        const out = await runOtelApp();

        expect(out.traceUrl).toBe('http://localhost:4318/v1/traces');
        expect(out.logs.filter((l: any) => l.level === 'warn')).toEqual([]);
    }, 20000);
});
