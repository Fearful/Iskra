/**
 * Outbound custom mail headers callers may set on every provider. Anything
 * else is rejected so a caller cannot spoof Sender / routing headers via the
 * generic `headers` map.
 */
export const ALLOWED_HEADERS = [
    "reply-to",
    "in-reply-to",
    "references",
    "list-unsubscribe",
    "list-unsubscribe-post",
    "list-id",
] as const;

/**
 * Truncate a header value at the first CR/LF. Anything after a line break is an
 * injected header (or folded continuation) and must be dropped, not preserved.
 */
export const stripCrlf = (value: string): string => value.split(/[\r\n]/)[0] ?? "";

/** The `headers` of a message, checked against `allowed` and without CR/LF. */
export function checkHeaders(
    headers: Record<string, string> | undefined,
    allowed: readonly string[] = ALLOWED_HEADERS,
): Record<string, string> | undefined {
    if (!headers) return undefined;
    const checked: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (!allowed.includes(key.toLowerCase())) {
            throw new Error(`Header "${key}" is not allowed`);
        }
        checked[key] = stripCrlf(value);
    }
    return checked;
}

/** A bare addr-spec: no display name, brackets, separators, quotes or whitespace. */
export function checkEmail(email: string): string {
    const trimmed = email.trim();
    if (!trimmed || /[\s<>,;"\\]/.test(trimmed)) {
        throw new Error(`Invalid email address: ${JSON.stringify(email)}`);
    }
    return trimmed;
}

/** A display name on one line (CR/LF would start a new header). */
export const cleanName = (name: string): string => name.replace(/[\r\n]+/g, " ").trim();

/**
 * `from` as an RFC 5322 mailbox. A display name with special characters is
 * quoted (with `"` and `\` escaped), or RFC 2047-encoded when it is not
 * ASCII. Interpolated as is, a name such as `Ana" <ceo@bank.com>, "x` added a
 * sender of the caller's choice.
 */
export function formatAddress(from: { name?: string; email: string }): string {
    const email = checkEmail(from.email);
    const name = from.name ? cleanName(from.name) : "";
    if (!name) return email;
    // Words of RFC 5322 atext need no quoting.
    if (/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(name)) return `${name} <${email}>`;
    if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
    return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?= <${email}>`;
}
