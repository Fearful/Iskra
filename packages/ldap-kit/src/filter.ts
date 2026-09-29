/**
 * A value for an LDAP filter (RFC 4515): `*`, `(`, `)`, `\` and NUL
 * escaped, so a login like `*)(uid=*` matches only itself.
 */
export function escapeFilterValue(value: string): string {
    return value.replace(/[*()\\\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/**
 * A filter with its interpolated values escaped (`escapeFilterValue`):
 *
 * ```ts
 * ldapFilter`(&(objectClass=user)(sAMAccountName=${login}))`
 * ```
 */
export function ldapFilter(strings: TemplateStringsArray, ...values: unknown[]): string {
    return strings.reduce(
        (out, text, i) => out + text + (i < values.length ? escapeFilterValue(String(values[i])) : ''),
        '',
    );
}

/**
 * A value for a DN's attribute (RFC 4514): `,`, `+`, `"`, `\`, `<`, `>`,
 * `;`, `=` and NUL escaped, and a leading `#` or space and a trailing space.
 */
export function escapeDnValue(value: string): string {
    return value
        .replace(/[,+"\\<>;=\0]/g, (ch) => (ch === '\0' ? '\\00' : `\\${ch}`))
        .replace(/^([#\s])/, '\\$1')
        .replace(/(\s)$/, '\\$1');
}

/** A date as LDAP's GeneralizedTime: `20240131235959.0Z`. */
export function generalizedTime(date: Date): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return (
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.0Z`
    );
}
