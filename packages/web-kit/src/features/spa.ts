import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Context } from 'hono';
import { isProductionEnv } from '@iskra-bun/core';
import type { Feature, Kernel } from '../types';
import { consoleLogger, type KernelLogger } from '../logging';

/** Public values the client app reads at startup, as JSON. */
export type AppConfigValue = Record<string, unknown>;

export interface SpaConfig {
    /** The built client app (Vite's `dist/`). */
    root: string;
    /** Its entry page. Default `index.html`. */
    index?: string;
    /**
     * Path prefixes that never get the app: an unknown path under them is a
     * 404 by the response contract. Default `['/api']`; AuthFeature's
     * `basePath` and HealthCheckFeature's paths are always added.
     */
    exclude?: string[];
    /**
     * The directory, under `root`, of the files whose names carry a content
     * hash: served `immutable` for a year, never answered with the app when
     * missing. Default `assets` (Vite's `build.assetsDir`).
     */
    assetsDir?: string;
    /**
     * Put in the page as `window.__APP_CONFIG__` (see `configGlobal`) when
     * the server starts, so one build serves every environment. A function
     * is called once, at startup. Everything here is public.
     */
    config?: AppConfigValue | (() => AppConfigValue | Promise<AppConfigValue>);
    /** The global the config is assigned to. Default `__APP_CONFIG__`. */
    configGlobal?: string;
    /**
     * The page's Content-Security-Policy, given the config script's hash
     * (`'sha256-…'`) to allow it: `(hash) => \`default-src 'self'; script-src 'self' ${hash}\``.
     */
    contentSecurityPolicy?: (configScriptHash: string) => string;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** `value` as JSON that cannot close the `<script>` it is put in. */
export function scriptSafeJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

interface StaticFile {
    path: string;
    cacheControl: string;
    etag?: string;
}

/** The regular files under `dir`, by path relative to it with `/`; dotfiles and symlinks are left out. */
function listFiles(dir: string, prefix = ''): Map<string, string> {
    const files = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            for (const [rel, abs] of listFiles(path, relative)) files.set(rel, abs);
        } else if (entry.isFile()) {
            files.set(relative, path);
        }
    }
    return files;
}

/** The path's segments, decoded; null for one no file can have (`..`, an encoded slash, a dotfile…). */
function segmentsOf(pathname: string): string[] | null {
    const segments: string[] = [];
    for (const raw of pathname.split('/').slice(1)) {
        let segment: string;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            return null;
        }
        if (segment === '') continue;
        if (segment.startsWith('.') || /[/\\\0]/.test(segment)) return null;
        segments.push(segment);
    }
    return segments;
}

/** Whether the request's If-None-Match names `etag` (weak comparison, as for GET). */
function matchesEtag(c: Context, etag: string): boolean {
    const header = c.req.header('if-none-match');
    if (!header) return false;
    const bare = (tag: string) => tag.trim().replace(/^W\//, '');
    return header.trim() === '*' || header.split(',').some((tag) => bare(tag) === bare(etag));
}

/**
 * Serves a built client app (an SPA) from the same process: its files from
 * `root`, and its entry page for every other path the app routes in the
 * browser, so a reload of `/boards/42` works. It answers only what no route
 * takes (Kernel.setFallback), so it never hides an API route, and never
 * under `exclude`, where an unknown path stays a JSON 404.
 *
 * Hashed assets (`assetsDir`) are cached for a year as `immutable`; the
 * entry page and the other files are revalidated (`no-cache`, with an
 * ETag). With `config`, the page gets `window.__APP_CONFIG__` when the
 * server starts, so a single build runs in every environment.
 *
 * The files are listed at startup: only regular files under `root` are
 * served, never dotfiles or symlinks, whatever the path asks for. In
 * development the Vite dev server (with its proxy) does this job; without
 * the entry page the feature serves nothing there, and refuses to start in
 * production.
 */
export class SpaFeature implements Feature {
    readonly name = 'spa';
    private log: KernelLogger = consoleLogger;
    private readonly config: SpaConfig;
    private files = new Map<string, StaticFile>();
    private page?: { html: string; etag: string; csp?: string };
    private exclude: string[] = [];
    private assetsPrefix: string;
    private scriptHash?: string;

    constructor(config: SpaConfig) {
        this.config = config;
        this.assetsPrefix = `${(config.assetsDir ?? 'assets').replace(/^\/+|\/+$/g, '')}/`;
    }

    /** The config script's CSP source (`'sha256-…'`), once initialized with `config`. */
    get configScriptHash(): string | undefined {
        return this.scriptHash;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const root = resolve(this.config.root);
        const indexName = this.indexName();

        let listed = new Map<string, string>();
        try {
            listed = listFiles(root);
        } catch {
            // No root: reported below as a missing entry page.
        }
        if (!listed.has(indexName)) {
            const message = `SpaFeature: ${join(root, indexName)} not found`;
            if (isProductionEnv()) throw new Error(`${message}; build the client app before starting`);
            this.log.warn(`${message}; serving no client app (use the Vite dev server in development)`);
            return;
        }

        for (const [relative, path] of listed) {
            const immutable = relative.startsWith(this.assetsPrefix);
            const stat = lstatSync(path);
            this.files.set(relative, {
                path,
                cacheControl: immutable ? IMMUTABLE : REVALIDATE,
                ...(!immutable && { etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"` }),
            });
        }
        this.files.delete(indexName);
        this.page = await this.buildPage(listed.get(indexName)!);

        const health = kernel.getFeature('health');
        const auth = kernel.getFeature('auth');
        this.exclude = [
            ...(this.config.exclude ?? ['/api']),
            ...(health?.paths ?? []),
            ...(auth ? [auth.basePath] : []),
        ]
            .map((prefix) => `/${prefix.replace(/^\/+|\/+$/g, '')}`)
            .filter((prefix) => prefix !== '/');
        kernel.setFallback((c) => this.serve(c));
    }

    private async buildPage(indexPath: string): Promise<{ html: string; etag: string; csp?: string }> {
        let html = await Bun.file(indexPath).text();
        if (this.config.config !== undefined) {
            const value = typeof this.config.config === 'function' ? await this.config.config() : this.config.config;
            const global = this.config.configGlobal ?? '__APP_CONFIG__';
            if (!/^[A-Za-z_$][\w$]*$/.test(global)) throw new Error(`SpaFeature: invalid configGlobal "${global}"`);
            const script = `window.${global}=${scriptSafeJson(value)};`;
            this.scriptHash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
            const tag = `<script>${script}</script>`;
            if (html.includes('<!--app-config-->')) html = html.replace('<!--app-config-->', tag);
            else if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${tag}</head>`);
            else
                throw new Error(
                    'SpaFeature: the entry page has no </head> (or <!--app-config-->) to put the config in',
                );
        }
        const etag = `"${createHash('sha256').update(html).digest('base64url').slice(0, 27)}"`;
        const csp = this.config.contentSecurityPolicy?.(this.scriptHash ?? "'none'");
        return { html, etag, ...(csp && { csp }) };
    }

    private excluded(pathname: string): boolean {
        return this.exclude.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    }

    private indexName(): string {
        return this.config.index ?? 'index.html';
    }

    private serve(c: Context): Response | undefined {
        // Hono drops the body of a HEAD answer.
        if (!this.page || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return undefined;
        const pathname = new URL(c.req.url).pathname;
        const segments = segmentsOf(pathname);
        if (!segments) return undefined;
        const relative = segments.join('/');
        // Both spellings: `/%61pi/x` is `/api/x` too.
        if (this.excluded(pathname) || this.excluded(`/${relative}`)) return undefined;

        if (relative === this.indexName()) return this.respondPage(c);
        const file = this.files.get(relative);
        if (file) return this.respond(c, file);
        // A missing hashed asset (an old build's) is a 404, not the page: as
        // HTML, a script would fail with a confusing MIME type error.
        if (relative.startsWith(this.assetsPrefix)) return undefined;
        const last = segments.at(-1) ?? '';
        const navigation = !last.includes('.') || (c.req.header('accept') ?? '').includes('text/html');
        return navigation ? this.respondPage(c) : undefined;
    }

    private respond(c: Context, file: StaticFile): Response {
        const headers: Record<string, string> = { 'Cache-Control': file.cacheControl };
        if (file.etag) {
            headers.ETag = file.etag;
            if (matchesEtag(c, file.etag)) return new Response(null, { status: 304, headers });
        }
        return new Response(Bun.file(file.path), { headers });
    }

    private respondPage(c: Context): Response {
        const page = this.page!;
        const headers: Record<string, string> = {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': REVALIDATE,
            ETag: page.etag,
            ...(page.csp && { 'Content-Security-Policy': page.csp }),
        };
        if (matchesEtag(c, page.etag)) return new Response(null, { status: 304, headers });
        return new Response(page.html, { headers });
    }
}
