/**
 * `@iskra-bun/testing-kit/parity`: sends the same requests to a service and
 * to its replacement and reports where the answers differ, for migrations.
 */
import type { RequestHandler } from './test-server';

/** A request to send to both services. */
export interface ParityCase {
    name?: string;
    /** Default GET. */
    method?: string;
    /** Path and query, `/api/users?page=2`. */
    path: string;
    headers?: Record<string, string>;
    /** Sent as JSON. */
    body?: unknown;
}

/** A service: its base URL, or an app with `request()` (a Hono app, `createTestKernel()`'s). */
export type ParityTarget = string | RequestHandler;

export interface ParityOptions {
    /** The service being replaced. */
    legacy: ParityTarget;
    /** Its replacement. */
    candidate: ParityTarget;
    /**
     * `'json'` (default): JSON bodies compared as values (key order aside),
     * without `ignorePaths`. `'exact'`: bodies compared as text, byte for byte.
     */
    mode?: 'json' | 'exact';
    /** JSON paths left out of the comparison: `$.timestamp`, `$.data[*].updatedAt`, `$.items[0].id`. */
    ignorePaths?: string[];
    /**
     * Response headers compared, by value; a header one side sends and the
     * other does not is a difference. Default `['content-type']`.
     */
    headers?: string[];
    /**
     * `'exact'` mode: read Go's encoding/json escapes (`<`, `>`,
     * `&`) in the legacy body as `<`, `>`, `&`, which JS writes as they are.
     */
    goHtmlEscape?: boolean;
    /** Headers of every request (the credentials both services accept). */
    requestHeaders?: Record<string, string>;
    /** Allow methods other than GET and HEAD: they change data on both services. Default false. */
    allowWrite?: boolean;
}

/** What a service answered. */
export interface ParitySnapshot {
    status: number;
    headers: Record<string, string | null>;
    body: string;
}

export interface ParityResult {
    case: ParityCase;
    equal: boolean;
    /** Each difference, as `status: 200 ≠ 404` or `$.data[0].name: "Ana" ≠ "ANA"`. */
    differences: string[];
    legacy: ParitySnapshot;
    candidate: ParitySnapshot;
}

async function send(target: ParityTarget, c: ParityCase, options: ParityOptions): Promise<ParitySnapshot> {
    const headers = new Headers({ ...options.requestHeaders, ...c.headers });
    if (c.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const init: RequestInit = {
        method: c.method ?? 'GET',
        headers,
        ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    };
    const res =
        typeof target === 'string' ? await fetch(new URL(c.path, target), init) : await target.request(c.path, init);
    const compared = (options.headers ?? ['content-type']).map((h) => h.toLowerCase());
    return {
        status: res.status,
        headers: Object.fromEntries(compared.map((h) => [h, res.headers.get(h)])),
        body: await res.text(),
    };
}

const show = (value: unknown) => {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

type Segment = string | number | '*';

/** `$.data[*].id` → ['data', '*', 'id']. */
function parsePath(path: string): Segment[] {
    const segments: Segment[] = [];
    for (const [, key, index] of path.replace(/^\$/, '').matchAll(/\.([^.[\]]+)|\[(\*|\d+)\]/g)) {
        if (key !== undefined) segments.push(key === '*' ? '*' : key);
        else segments.push(index === '*' ? '*' : Number(index));
    }
    return segments;
}

/** `value` without what `segments` points at. */
function without(value: unknown, segments: Segment[]): unknown {
    if (segments.length === 0 || typeof value !== 'object' || value === null) return value;
    const [head, ...rest] = segments;
    if (Array.isArray(value)) {
        return value.flatMap((item, i) => {
            if (head !== '*' && head !== i) return [item];
            return rest.length === 0 ? [] : [without(item, rest)];
        });
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (head !== '*' && head !== key) out[key] = item;
        else if (rest.length > 0) out[key] = without(item, rest);
    }
    return out;
}

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
    if (out.length >= 50) return;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) out.push(`${path}: ${a.length} items ≠ ${b.length} items`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
        return;
    }
    const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (isObject(a) && isObject(b)) {
        const ra = a as Record<string, unknown>;
        const rb = b as Record<string, unknown>;
        for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
            if (!(key in rb)) out.push(`${path}.${key}: only in legacy`);
            else if (!(key in ra)) out.push(`${path}.${key}: only in candidate`);
            else diff(ra[key], rb[key], `${path}.${key}`, out);
        }
        return;
    }
    if (a !== b) out.push(`${path}: ${show(a)} ≠ ${show(b)}`);
}

const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
};

function compareBodies(legacy: string, candidate: string, options: ParityOptions): string[] {
    if (options.mode === 'exact') {
        const left = options.goHtmlEscape
            ? legacy
                  .replace(/\\u003c/g, '<')
                  .replace(/\\u003e/g, '>')
                  .replace(/\\u0026/g, '&')
            : legacy;
        if (left === candidate) return [];
        let i = 0;
        while (i < left.length && left[i] === candidate[i]) i++;
        return [`body differs at character ${i}: ${show(left.slice(i, i + 40))} ≠ ${show(candidate.slice(i, i + 40))}`];
    }
    const [a, b] = [parse(legacy), parse(candidate)];
    if (!a.ok || !b.ok) return legacy === candidate ? [] : [`body: ${show(legacy)} ≠ ${show(candidate)}`];
    const paths = (options.ignorePaths ?? []).map(parsePath);
    const strip = (value: unknown) => paths.reduce((v, segments) => without(v, segments), value);
    const out: string[] = [];
    diff(strip(a.value), strip(b.value), '$', out);
    return out;
}

/** Sends `c` to both services and compares their answers: status, the chosen headers and the body. */
export async function compareCase(c: ParityCase, options: ParityOptions): Promise<ParityResult> {
    const method = (c.method ?? 'GET').toUpperCase();
    if (!options.allowWrite && method !== 'GET' && method !== 'HEAD') {
        throw new Error(`Parity case ${method} ${c.path} changes data on both services: set allowWrite to send it`);
    }
    const [legacy, candidate] = await Promise.all([
        send(options.legacy, c, options),
        send(options.candidate, c, options),
    ]);
    const differences: string[] = [];
    if (legacy.status !== candidate.status) differences.push(`status: ${legacy.status} ≠ ${candidate.status}`);
    for (const [name, value] of Object.entries(legacy.headers)) {
        if (value !== candidate.headers[name])
            differences.push(`header ${name}: ${show(value)} ≠ ${show(candidate.headers[name])}`);
    }
    differences.push(...compareBodies(legacy.body, candidate.body, options));
    return { case: c, equal: differences.length === 0, differences, legacy, candidate };
}

/** Every case, one after the other (they may depend on each other's writes). */
export async function compareAll(cases: readonly ParityCase[], options: ParityOptions): Promise<ParityResult[]> {
    const results: ParityResult[] = [];
    for (const c of cases) results.push(await compareCase(c, options));
    return results;
}

/** A readable report of the results: one line per case, its differences under it. */
export function formatReport(results: readonly ParityResult[]): string {
    const lines = results.map((r) => {
        const title = `${r.equal ? '✓' : '✗'} ${r.case.name ?? `${r.case.method ?? 'GET'} ${r.case.path}`}`;
        return r.equal ? title : [title, ...r.differences.map((d) => `    ${d}`)].join('\n');
    });
    const failed = results.filter((r) => !r.equal).length;
    return `${lines.join('\n')}\n\n${results.length - failed}/${results.length} equal`;
}

/**
 * The requests of a HAR file (a browser's "Save all as HAR", or a proxy's
 * capture), as cases: method, path with query, JSON body. Headers are left
 * out (they carry cookies); set `requestHeaders` instead.
 */
export function casesFromHar(har: unknown): ParityCase[] {
    const entries = (har as { log?: { entries?: unknown[] } }).log?.entries ?? [];
    return entries.map((entry) => {
        const request = (entry as { request: { method: string; url: string; postData?: { text?: string } } }).request;
        const url = new URL(request.url);
        const text = request.postData?.text;
        const body = text ? parse(text) : undefined;
        return {
            method: request.method,
            path: url.pathname + url.search,
            ...(body?.ok ? { body: body.value } : {}),
        };
    });
}
