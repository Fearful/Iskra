/**
 * How `:name` placeholders are read when compiling binds by name to binds by
 * position: `'oracle'` skips string literals (q-quotes too), quoted
 * identifiers, comments and PL/SQL's `:=`; `'sqlx'` reads the SQL byte by byte
 * as Go's sqlx does, so SQL copied from a Go service (with its `::` for a
 * literal colon) compiles to the same statement.
 */
export type BindDialect = 'oracle' | 'sqlx';

export interface CompiledSql {
    /** The statement with positional placeholders. */
    sql: string;
    /** The values, in the order of the placeholders. */
    binds: unknown[];
    /** The param each position came from (for mapping OUT binds back to names). */
    names: string[];
}

const Q_QUOTE_CLOSE: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };

/** The value of a param: its exact name, else the one equal ignoring case. */
function valueOf(params: Readonly<Record<string, unknown>>, name: string): { key: string; value: unknown } {
    if (Object.hasOwn(params, name)) return { key: name, value: params[name] };
    const lower = name.toLowerCase();
    const key = Object.keys(params).find((k) => k.toLowerCase() === lower);
    if (key === undefined) throw new TypeError(`Bind :${name} has no value in the params`);
    return { key, value: params[key] };
}

/**
 * `:name` → `:1`, `:2`…, with Oracle's lexical rules: names match params
 * ignoring case, a name used twice takes its value twice, params the SQL does
 * not use are left out, and an array expands to `:1, :2, :3` (an IN list).
 */
function compileOracle(sql: string, params: Readonly<Record<string, unknown>>): CompiledSql {
    let out = '';
    const binds: unknown[] = [];
    const names: string[] = [];
    const placeholder = (key: string, value: unknown) => {
        binds.push(value);
        names.push(key);
        return `:${binds.length}`;
    };
    let i = 0;
    let from = 0;
    while (i < sql.length) {
        const c = sql[i]!;
        if ((c === 'q' || c === 'Q') && sql[i + 1] === "'" && i + 2 < sql.length) {
            const open = sql[i + 2]!;
            const end = sql.indexOf(`${Q_QUOTE_CLOSE[open] ?? open}'`, i + 3);
            i = end === -1 ? sql.length : end + 2;
        } else if (c === "'") {
            i++;
            while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
            i++;
        } else if (c === '"') {
            const end = sql.indexOf('"', i + 1);
            i = end === -1 ? sql.length : end + 1;
        } else if (sql.startsWith('--', i)) {
            const end = sql.indexOf('\n', i);
            i = end === -1 ? sql.length : end + 1;
        } else if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 2;
        } else if (c === ':' && /[A-Za-z0-9_$#]/.test(sql[i + 1] ?? '')) {
            const name = /^[A-Za-z0-9_$#]+/.exec(sql.slice(i + 1))![0];
            const { key, value } = valueOf(params, name);
            out += sql.slice(from, i);
            if (Array.isArray(value)) {
                if (value.length === 0) throw new TypeError(`Bind :${name} is an empty list`);
                out += value.map((item) => placeholder(key, item)).join(', ');
            } else {
                out += placeholder(key, value);
            }
            i += 1 + name.length;
            from = i;
        } else {
            i++;
        }
    }
    return { sql: out + sql.slice(from), binds, names };
}

// ─── sqlx ────────────────────────────────────────────────────────────────────
// A port of what sqlx v1.4.0 (MIT) does for a named query with a map:
// compileNamedQuery (bindType QUESTION) → bindMapArgs → In → Rebind(NAMED).
// Its quirks are kept on purpose: the SQL is read as bytes, `::` is a literal
// colon, a `?` is rebound even inside a string literal.

const COLON = 0x3a;
const EQUALS = 0x3d;
const QUESTION = 0x3f;

/** unicode.IsOneOf({Letter, Digit}, rune(b)): sqlx reads bytes, so ≥ 0x80 is taken as Latin-1. */
const allowedRune = (b: number) => /^[\p{L}\p{Nd}]$/u.test(String.fromCharCode(b));

/** compileNamedQuery (named.go): names → `?`. */
function compileNamedQuery(query: string): { sql: string; names: string[] } {
    const qs = new TextEncoder().encode(query);
    const last = qs.length - 1;
    const rebound: number[] = [];
    const names: string[] = [];
    let name: number[] = [];
    let inName = false;
    for (let i = 0; i < qs.length; i++) {
        const b = qs[i]!;
        if (b === COLON) {
            if (inName && i > 0 && qs[i - 1] === COLON) {
                rebound.push(COLON);
                inName = false;
                continue;
            }
            if (inName) throw new TypeError(`unexpected \`:\` while reading named param at ${i}`);
            inName = true;
            name = [];
        } else if (inName && i > 0 && b === EQUALS && name.length === 0) {
            rebound.push(COLON, EQUALS);
            inName = false;
        } else if (inName && (allowedRune(b) || b === 0x5f || b === 0x2e) && i !== last) {
            name.push(b);
        } else if (inName) {
            inName = false;
            if (i === last && allowedRune(b)) name.push(b);
            names.push(new TextDecoder().decode(new Uint8Array(name)));
            rebound.push(QUESTION);
            if (i !== last || !allowedRune(b)) rebound.push(b);
        } else {
            rebound.push(b);
        }
    }
    return { sql: new TextDecoder().decode(new Uint8Array(rebound)), names };
}

/** sqlx: a name missing from the map is an error (the names match exactly). */
function bindMapArgs(names: readonly string[], params: Readonly<Record<string, unknown>>): unknown[] {
    return names.map((name) => {
        if (!Object.hasOwn(params, name)) throw new TypeError(`could not find name ${name} in map`);
        return params[name];
    });
}

/** sqlx.In: each array expands its `?` into `?, ?, …`. */
function expandIn(
    sql: string,
    args: readonly unknown[],
    names: readonly string[],
): { sql: string; args: unknown[]; names: string[] } {
    if (!args.some(Array.isArray)) return { sql, args: [...args], names: [...names] };
    const parts = sql.split('?');
    if (parts.length - 1 > args.length) throw new TypeError('number of bindVars exceeds arguments');
    const flat: unknown[] = [];
    const flatNames: string[] = [];
    let out = parts[0]!;
    args.forEach((arg, i) => {
        if (Array.isArray(arg)) {
            if (arg.length === 0) throw new TypeError("empty slice passed to 'in' query");
            flat.push(...arg);
            flatNames.push(...arg.map(() => names[i]!));
            out += arg.map(() => '?').join(', ');
        } else {
            flat.push(arg);
            flatNames.push(names[i]!);
            out += '?';
        }
        out += parts[i + 1] ?? '';
    });
    return { sql: out, args: flat, names: flatNames };
}

function compileSqlx(query: string, params: Readonly<Record<string, unknown>>): CompiledSql {
    const compiled = compileNamedQuery(query);
    const expanded = expandIn(compiled.sql, bindMapArgs(compiled.names, params), compiled.names);
    // Rebind(NAMED): every `?` becomes `:argN`, inside literals too.
    let n = 0;
    return { sql: expanded.sql.replace(/\?/g, () => `:arg${++n}`), binds: expanded.args, names: expanded.names };
}

/**
 * Compiles a statement with binds by name to one with binds by position, as
 * `bindStyle: 'positional'` does: Oracle then never sees a bind name, so
 * params the SQL does not use, names that are reserved words (`:date`,
 * `:user`) and names in another case cannot fail it.
 *
 * ```ts
 * compileNamed('SELECT * FROM t WHERE id IN (:ids) AND owner = :owner', { ids: [1, 2], owner: 'ana', extra: 1 });
 * // { sql: 'SELECT * FROM t WHERE id IN (:1, :2) AND owner = :3', binds: [1, 2, 'ana'], names: [...] }
 * ```
 */
export function compileNamed(
    sql: string,
    params: Readonly<Record<string, unknown>>,
    dialect: BindDialect = 'oracle',
): CompiledSql {
    return dialect === 'sqlx' ? compileSqlx(sql, params) : compileOracle(sql, params);
}
