import { Hono, type Context, type Handler, type MiddlewareHandler } from 'hono';
import { TrieRouter } from 'hono/router/trie-router';
import { problem, responderOf } from './contract';

/** A route's handlers: middleware (which call `next()`) and, last, the handler. */
export type RouteHandler = MiddlewareHandler | Handler;

/** What a group does with a request under its prefix that no route takes. */
export interface UnmatchedOptions {
    /**
     * Middleware to run first, such as an auth check, so a guest gets 401
     * instead of learning which paths exist. Default: the group's middleware.
     */
    use?: RouteHandler[];
    /**
     * `404` (the default), or `'auto'`: 405 with an `Allow` header when the
     * path has routes for other methods, 404 otherwise.
     */
    then?: 404 | 'auto';
}

interface RouteDef {
    readonly method: string;
    readonly path: string;
    readonly handlers: readonly RouteHandler[];
}

interface UnmatchedDef {
    readonly prefix: string;
    readonly use: readonly RouteHandler[];
    readonly then: 404 | 'auto';
}

/** Hono's name for any method. */
const ALL = 'ALL';

/** `\:` in a path is a literal colon (Hono already reads a `:` inside a segment as one). */
const toHonoPath = (path: string) => (path === '' ? '/' : path.replace(/\\:/g, ':'));

/** `/prefix/*`, which Hono also matches for `/prefix` and `/prefix/`. */
const catchAll = (prefix: string) => `${toHonoPath(prefix).replace(/\/$/, '')}/*`;

/** Per segment: 0 static, 1 parameter, 2 wildcard. */
const specificity = (path: string) =>
    path.split('/').map((segment) => (segment.includes('*') ? 2 : segment.startsWith(':') ? 1 : 0));

/** Static segments before parameters before wildcards, segment by segment; then the longer path. */
function compareSpecificity(a: string, b: string): number {
    const [sa, sb] = [specificity(a), specificity(b)];
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
        if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    }
    return sb.length - sa.length;
}

/** By path specificity, then a named method before `ALL`; otherwise in the order they were added. */
const compareRoutes = (a: RouteDef, b: RouteDef) =>
    compareSpecificity(a.path, b.path) || Number(a.method === ALL) - Number(b.method === ALL);

function assertNoDuplicates(routes: readonly RouteDef[]): void {
    const seen = new Set<string>();
    for (const route of routes) {
        // Parameter names do not make two paths different.
        const key = `${route.method} ${route.path.replace(/\/:[^/]+/g, '/:')}`;
        if (seen.has(key)) throw new Error(`Route added twice: ${route.method} ${route.path}`);
        seen.add(key);
    }
}

class Registry {
    readonly routes: RouteDef[] = [];
    readonly unmatched = new Map<string, UnmatchedDef>();
}

/**
 * Routes under a prefix with the middleware they share. A subgroup inherits
 * its parent's middleware; `use()` adds middleware to the routes added after
 * it. See `Router`.
 */
export class RouteGroup {
    protected constructor(
        protected readonly registry: Registry,
        /** The group's path prefix, `/api/v1`. */
        readonly prefix: string,
        private middleware: readonly RouteHandler[],
    ) {}

    /** Adds middleware to the routes (and subgroups) added after this call. */
    use(...middleware: RouteHandler[]): this {
        this.middleware = [...this.middleware, ...middleware];
        return this;
    }

    /** A subgroup under `prefix`: this group's middleware, then `middleware`. */
    group(prefix: string, ...middleware: RouteHandler[]): RouteGroup {
        return new RouteGroup(this.registry, this.prefix + prefix, [...this.middleware, ...middleware]);
    }

    /** A route for `method` (or several): the group's middleware, then `handlers`. */
    on(method: string | readonly string[], path: string, ...handlers: RouteHandler[]): this {
        if (handlers.length === 0) throw new Error(`Route ${this.prefix + path} has no handler`);
        const full = toHonoPath(this.prefix + path);
        for (const m of typeof method === 'string' ? [method] : method) {
            this.registry.routes.push({
                method: m.toUpperCase(),
                path: full,
                handlers: [...this.middleware, ...handlers],
            });
        }
        return this;
    }

    get(path: string, ...handlers: RouteHandler[]): this {
        return this.on('GET', path, ...handlers);
    }

    post(path: string, ...handlers: RouteHandler[]): this {
        return this.on('POST', path, ...handlers);
    }

    put(path: string, ...handlers: RouteHandler[]): this {
        return this.on('PUT', path, ...handlers);
    }

    patch(path: string, ...handlers: RouteHandler[]): this {
        return this.on('PATCH', path, ...handlers);
    }

    delete(path: string, ...handlers: RouteHandler[]): this {
        return this.on('DELETE', path, ...handlers);
    }

    options(path: string, ...handlers: RouteHandler[]): this {
        return this.on('OPTIONS', path, ...handlers);
    }

    /** A route for every method (a named method's route on the same path comes first). */
    all(path: string, ...handlers: RouteHandler[]): this {
        return this.on(ALL, path, ...handlers);
    }

    /**
     * What happens to a request under this group's prefix that no route
     * takes (an unknown path, a method with no route, a made-up method): it
     * runs `use` (by default the group's middleware), then answers 404, or
     * 405 with `then: 'auto'`, by the response contract. Called again for the
     * same prefix, the last call wins.
     */
    unmatched(options: UnmatchedOptions = {}): this {
        this.registry.unmatched.set(this.prefix, {
            prefix: this.prefix,
            use: options.use ?? this.middleware,
            then: options.then ?? 404,
        });
        return this;
    }
}

/**
 * Routes in groups, with the middleware each group shares:
 *
 * ```ts
 * const api = new Router();
 * const v1 = api.group('/api/v1', requestLog);
 * v1.use(auth);
 * v1.group('/users', requireScopes('users:read')).get('/:id', getUser);
 * v1.unmatched({ then: 'auto' }); // auth runs first: a guest gets 401, not 404
 * new WebPlugin({ router: api });
 * ```
 *
 * The routes are registered on Hono by priority, not in the order they were
 * added: static segments before parameters before wildcards (`/users/me`
 * before `/users/:id`), and a route for a named method before one for every
 * method. Two routes with the same method and path shape are an error.
 */
export class Router extends RouteGroup {
    constructor() {
        super(new Registry(), '', []);
    }

    /**
     * Registers the routes on `app` (a new Hono app by default), then the
     * unmatched handlers, the most specific prefix first. WebPlugin does it
     * on the Kernel's app; paths are the full ones, so compile onto the app
     * that serves them rather than a sub-app mounted under a prefix.
     */
    compile(app: Hono = new Hono()): Hono {
        const { routes, unmatched } = this.registry;
        assertNoDuplicates(routes);
        const on = app.on.bind(app) as unknown as (method: string, path: string, ...handlers: RouteHandler[]) => void;
        for (const route of [...routes].sort(compareRoutes)) on(route.method, route.path, ...route.handlers);

        const methods = methodTable(routes);
        const guards = [...unmatched.values()].sort((a, b) =>
            compareSpecificity(catchAll(a.prefix), catchAll(b.prefix)),
        );
        for (const guard of guards) {
            on(ALL, catchAll(guard.prefix), ...guard.use, (c: Context) => {
                const allowed = guard.then === 'auto' ? methods(c.req.path) : [];
                if (allowed.length === 0) return responderOf(c).problem(c, problem(404));
                return responderOf(c).problem(c, problem(405, { headers: { Allow: allowed.join(', ') } }));
            });
        }
        return app;
    }
}

/** The methods with a route for a path (`HEAD` along with `GET`, which serves it). */
function methodTable(routes: readonly RouteDef[]): (path: string) => string[] {
    const table = new TrieRouter<string>();
    for (const route of routes) table.add(route.method, route.path, route.method);
    const named = [...new Set(routes.map((r) => r.method).filter((m) => m !== ALL))];
    return (path) => {
        const allowed = named.filter((method) => table.match(method, path)[0].some(([value]) => value === method));
        return allowed.includes('GET') && !allowed.includes('HEAD')
            ? allowed.flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m]))
            : allowed;
    };
}
