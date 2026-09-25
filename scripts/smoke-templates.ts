/**
 * Smoke test for the templates' Docker images: each one is built with its own
 * Dockerfile, started the way its README documents, and probed over HTTP. A
 * template that builds but crashes on start (an unwritable SQLite path, a
 * missing env default) or never answers fails here instead of for its users.
 *
 *   bun scripts/smoke-templates.ts                 # every template
 *   bun scripts/smoke-templates.ts cms-starter …   # only these
 *   bun scripts/smoke-templates.ts --no-build      # reuse iskra-smoke/<name> images
 *
 * Needs Docker (and Compose v2 for forms-app). Run from the repository root.
 */
/* eslint-disable no-console -- a CLI script: its report goes to stdout/stderr. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

interface Probe {
    path: string;
    /** Sent as a JSON POST; without it the probe is a GET. */
    body?: unknown;
    /** Exact status expected; without it any response below 500 passes. */
    status?: number;
}

interface ImageCase {
    kind: 'image';
    name: string;
    port: number;
    probes: Probe[];
    env?: Record<string, string>;
    /** Starts a Redis container on the smoke network, reachable as `redis`. */
    redis?: boolean;
}

interface ComposeCase {
    kind: 'compose';
    name: string;
    file: string;
    /** Probed through the published nginx port. */
    probes: Probe[];
    /**
     * Unpublished services (`service:port/path`), each probed from inside a
     * container on one of its networks: the stack is segmented, so nginx
     * reaches only the services it proxies.
     */
    internal: { from: ProbeContainer; target: string }[];
    /**
     * Variables the compose file requires (`${VAR:?}`, its secrets): each run
     * gets random ones. Hex, since some go into connection URLs.
     */
    secrets: string[];
}

type Case = ImageCase | ComposeCase;

/** Compose services with an HTTP client: nginx:alpine's busybox wget, form-manager's Bun. */
type ProbeContainer = 'nginx' | 'form-manager';

/** A command, run in `from`, that exits 0 when `url` answers with a 2xx. */
function fetchCommand(from: ProbeContainer, url: string): string[] {
    if (from === 'nginx') return ['wget', '-q', '-O', '/dev/null', url];
    const fetchCall = `fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(5000) })`;
    return ['bun', '-e', `process.exit((await ${fetchCall}).ok ? 0 : 1)`];
}

const CASES: Case[] = [
    { kind: 'image', name: 'simple-server', port: 3000, probes: [{ path: '/', status: 200 }] },
    { kind: 'image', name: 'starter-app', port: 3000, probes: [{ path: '/users', status: 200 }] },
    { kind: 'image', name: 'db-starter', port: 3000, probes: [{ path: '/' }] },
    { kind: 'image', name: 'cms-starter', port: 3000, probes: [{ path: '/content', status: 200 }] },
    { kind: 'image', name: 'ecommerce-api', port: 3000, probes: [{ path: '/api/products', status: 200 }] },
    { kind: 'image', name: 'realtime-feed', port: 3000, probes: [{ path: '/feed', status: 200 }] },
    { kind: 'image', name: 'full-stack-app', port: 3000, probes: [{ path: '/doc', status: 200 }] },
    {
        kind: 'image',
        name: 'python-data-processor',
        port: 3000,
        // /process goes through the Python script: /health alone answers
        // even when the image has no python3.
        probes: [
            { path: '/health', status: 200 },
            { path: '/process', body: { data: [1, 2, 3] }, status: 200 },
        ],
    },
    // A WebSocket server: a plain GET gets 426 Upgrade Required.
    {
        kind: 'image',
        name: 'chat-app',
        port: 3001,
        probes: [{ path: '/', status: 426 }],
        env: { CHAT_AUTH_SECRET: 'smoke-test-secret' },
    },
    {
        kind: 'image',
        name: 'job-worker',
        port: 8080,
        probes: [{ path: '/health', status: 200 }],
        env: { REDIS_URL: 'redis://redis:6379' },
        redis: true,
    },
    {
        kind: 'compose',
        name: 'forms-app',
        file: 'templates/forms-app/docker-compose.yml',
        probes: [
            { path: '/formularios/health', status: 200 },
            { path: '/admin/', status: 200 },
        ],
        internal: [
            { from: 'nginx', target: 'admin-api:4000/health' },
            { from: 'form-manager', target: 'form-manager:4001/health' },
            { from: 'form-manager', target: 'cron:4002/health' },
        ],
        secrets: ['DB_PASSWORD', 'REDIS_PASSWORD', 'AUTH_SECRET', 'CSRF_SECRET', 'IP_HASH_SECRET', 'RECAPTCHA_SECRET'],
    },
];

const NETWORK = 'iskra-smoke';
const REDIS = 'iskra-smoke-redis';
const COMPOSE_PROJECT = 'iskra-smoke-forms';
const START_TIMEOUT_MS = 60_000;
/** How long a started container must keep running after its probes pass. */
const SETTLE_MS = 3_000;

function docker(
    args: string[],
    opts: { quiet?: boolean; allowFail?: boolean; env?: NodeJS.ProcessEnv } = {},
): { ok: boolean; out: string } {
    const res = spawnSync('docker', args, {
        encoding: 'utf8',
        stdio: opts.quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'],
        env: opts.env,
    });
    const ok = res.status === 0;
    if (!ok && !opts.allowFail) throw new Error(`docker ${args.join(' ')} failed (${res.status})\n${res.stderr ?? ''}`);
    return { ok, out: (res.stdout ?? '').trim() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status of the probe's request to `url`, or null when nothing answers yet. */
async function httpStatus(url: string, probe: Probe): Promise<number | null> {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(5_000),
            redirect: 'manual',
            ...(probe.body === undefined
                ? {}
                : {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(probe.body),
                  }),
        });
        await res.body?.cancel();
        return res.status;
    } catch {
        return null;
    }
}

const passes = (probe: Probe, status: number | null) =>
    status !== null && (probe.status === undefined ? status < 500 : status === probe.status);

async function waitForProbes(base: string, probes: Probe[], alive: () => boolean): Promise<string | null> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    const last = new Map<string, number | null>();
    while (Date.now() < deadline) {
        if (!alive()) return 'the container exited';
        let all = true;
        for (const probe of probes) {
            const status = await httpStatus(base + probe.path, probe);
            last.set(probe.path, status);
            if (!passes(probe, status)) all = false;
        }
        if (all) return null;
        await sleep(1_000);
    }
    const seen = [...last].map(([p, s]) => `${p} → ${s ?? 'no answer'}`).join(', ');
    return `probes did not pass within ${START_TIMEOUT_MS / 1000}s (${seen})`;
}

function running(container: string): boolean {
    const { ok, out } = docker(['inspect', '-f', '{{.State.Running}}', container], { quiet: true, allowFail: true });
    return ok && out === 'true';
}

async function runImage(c: ImageCase, build: boolean): Promise<string | null> {
    const image = `iskra-smoke/${c.name}`;
    const container = `iskra-smoke-${c.name}`;
    if (build) docker(['build', '-f', `templates/${c.name}/Dockerfile`, '-t', image, '.']);
    if (c.redis && !running(REDIS)) {
        docker(['rm', '-f', REDIS], { quiet: true, allowFail: true });
        docker(['run', '-d', '--name', REDIS, '--network', NETWORK, '--network-alias', 'redis', 'redis:7-alpine'], {
            quiet: true,
        });
    }

    docker(['rm', '-f', container], { quiet: true, allowFail: true });
    const env = Object.entries(c.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    docker(['run', '-d', '--name', container, '--network', NETWORK, '-p', `127.0.0.1::${c.port}`, ...env, image], {
        quiet: true,
    });
    let failure: string | null = null;
    try {
        const hostPort = docker(['port', container, `${c.port}/tcp`], { quiet: true })
            .out.split('\n')[0]
            .split(':')
            .pop();
        failure = await waitForProbes(`http://127.0.0.1:${hostPort}`, c.probes, () => running(container));
        if (!failure) {
            await sleep(SETTLE_MS);
            if (!running(container)) failure = 'the container exited after answering';
        }
        return failure;
    } finally {
        if (failure) docker(['logs', '--tail', '40', container], { allowFail: true });
        docker(['rm', '-f', container], { quiet: true, allowFail: true });
    }
}

async function runCompose(c: ComposeCase, build: boolean): Promise<string | null> {
    const compose = ['compose', '-f', c.file, '-p', COMPOSE_PROJECT];
    // Every compose command interpolates the file, so each one gets them (a
    // `down` without them fails as well).
    const env = { ...process.env, ...Object.fromEntries(c.secrets.map((v) => [v, randomBytes(32).toString('hex')])) };
    let failure: string | null = null;
    docker([...compose, 'up', '-d', ...(build ? ['--build'] : ['--no-build'])], { allowFail: true, env });
    try {
        failure = await probeCompose(c, compose, env);
        return failure;
    } finally {
        if (failure) docker([...compose, 'logs', '--tail', '30'], { allowFail: true, env });
        docker([...compose, 'down', '-v', '--remove-orphans'], { quiet: true, allowFail: true, env });
    }
}

async function probeCompose(c: ComposeCase, compose: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
    try {
        const exited = () =>
            docker([...compose, 'ps', '-a', '--status', 'exited', '--format', '{{.Service}}'], { quiet: true, env })
                .out;
        const failure = await waitForProbes('http://127.0.0.1:80', c.probes, () => exited() === '');
        if (failure) return `${failure}${exited() ? `; exited: ${exited().replace(/\n/g, ', ')}` : ''}`;
        // Services start at different speeds: retried until the same deadline.
        const answers = ({ from, target }: ComposeCase['internal'][number]) =>
            docker([...compose, 'exec', '-T', from, ...fetchCommand(from, `http://${target}`)], {
                quiet: true,
                allowFail: true,
                env,
            }).ok;
        const deadline = Date.now() + START_TIMEOUT_MS;
        let pending = c.internal;
        while ((pending = pending.filter((t) => !answers(t))).length > 0) {
            if (exited()) return `services exited: ${exited().replace(/\n/g, ', ')}`;
            if (Date.now() > deadline) return `no 200 from ${pending.map((t) => `http://${t.target}`).join(', ')}`;
            await sleep(1_000);
        }
        await sleep(SETTLE_MS);
        return exited() ? `services exited: ${exited().replace(/\n/g, ', ')}` : null;
    } catch (err) {
        return String(err);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const build = !args.includes('--no-build');
    const names = args.filter((a) => !a.startsWith('--'));
    const unknown = names.filter((n) => !CASES.some((c) => c.name === n));
    if (unknown.length) {
        console.error(`Unknown template(s): ${unknown.join(', ')}`);
        process.exit(2);
    }
    const selected = names.length ? CASES.filter((c) => names.includes(c.name)) : CASES;

    docker(['network', 'create', NETWORK], { quiet: true, allowFail: true });
    const failures: string[] = [];
    try {
        for (const c of selected) {
            console.log(`\n▶ ${c.name}`);
            const failure = c.kind === 'image' ? await runImage(c, build) : await runCompose(c, build);
            if (failure) {
                failures.push(`${c.name}: ${failure}`);
                console.error(`✘ ${c.name}: ${failure}`);
            } else {
                console.log(`✓ ${c.name}`);
            }
        }
    } finally {
        docker(['rm', '-f', REDIS], { quiet: true, allowFail: true });
        docker(['network', 'rm', NETWORK], { quiet: true, allowFail: true });
    }

    if (failures.length) {
        console.error(`\n${failures.length} of ${selected.length} template(s) failed:\n  ${failures.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`\n✓ ${selected.length} template(s) built, started and answered`);
}

await main();
