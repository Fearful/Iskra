import type { EmailAddress, EmailRecipient } from './types';

/**
 * Outbound custom mail headers callers may set on every provider. Anything
 * else is rejected so a caller cannot spoof Sender / routing headers via the
 * generic `headers` map.
 */
export const ALLOWED_HEADERS = [
    'reply-to',
    'in-reply-to',
    'references',
    'list-unsubscribe',
    'list-unsubscribe-post',
    'list-id',
] as const;

/**
 * Truncate a header value at the first CR/LF. Anything after a line break is an
 * injected header (or folded continuation) and must be dropped, not preserved.
 */
export const stripCrlf = (value: string): string => value.split(/[\r\n]/)[0] ?? '';

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

/**
 * What an address may not contain unquoted: whitespace and control characters,
 * and what starts a display name, comment, group or list (`<>()[]\,;:"`).
 * `a@evil.test:b@x.com` is a group that mails b@x.com only.
 */
const ADDRESS_SPECIALS = /[\s\p{Cc}<>()[\]\\,;:"]/u;

/** A bare addr-spec: one `@`, no display name, brackets, separators, quotes or whitespace. */
export function checkEmail(email: string): string {
    const trimmed = typeof email === 'string' ? email.trim() : '';
    const at = trimmed.indexOf('@');
    if (at < 1 || at !== trimmed.lastIndexOf('@') || at === trimmed.length - 1 || ADDRESS_SPECIALS.test(trimmed)) {
        throw new Error(`Invalid email address: ${JSON.stringify(email)}`);
    }
    return trimmed;
}

/** A display name on one line (CR/LF would start a new header). */
export const cleanName = (name: string): string => name.replace(/[\r\n]+/g, ' ').trim();

/**
 * The recipients of a `to`/`cc`/`bcc`/`replyTo` field, one mailbox each. A
 * string is a single bare address: one value such as
 * `"bob@x.com <spy@evil.test>, y@x.com"` or `"list: spy@evil.test;"` mailed
 * other people than the ones an allowlist checked. An object's address is
 * checked the same way and its name may not hold control characters.
 */
export function checkRecipients(
    value: EmailRecipient | EmailRecipient[] | undefined,
    field = 'recipient',
): EmailAddress[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((recipient) => {
        if (typeof recipient === 'string') return { address: checkEmail(recipient) };
        if (typeof recipient !== 'object' || recipient === null || typeof recipient.address !== 'string') {
            throw new Error(`Invalid ${field}: expected an email address or { name, address }`);
        }
        const { name, address } = recipient;
        if (name !== undefined && (typeof name !== 'string' || /\p{Cc}/u.test(name))) {
            throw new Error(`Invalid ${field} name: control characters (CR/LF) are not allowed`);
        }
        return name ? { name, address: checkEmail(address) } : { address: checkEmail(address) };
    });
}

/** `replyTo`, checked like the recipients: one address at most. */
export function checkReplyTo(value: EmailRecipient | undefined): EmailAddress | undefined {
    const list = checkRecipients(value, 'replyTo');
    if (list.length > 1) throw new Error('Invalid replyTo: expected a single address');
    return list[0];
}

/** A checked recipient as an RFC 5322 mailbox (see {@link formatAddress}). */
export const formatRecipient = ({ name, address }: EmailAddress): string => formatAddress({ name, email: address });

/**
 * `from` as an RFC 5322 mailbox. A display name with special characters is
 * quoted (with `"` and `\` escaped), or RFC 2047-encoded when it is not
 * ASCII. Interpolated as is, a name such as `Ana" <ceo@bank.com>, "x` added a
 * sender of the caller's choice.
 */
export function formatAddress(from: { name?: string; email: string }): string {
    const email = checkEmail(from.email);
    const name = from.name ? cleanName(from.name) : '';
    if (!name) return email;
    // Words of RFC 5322 atext need no quoting.
    if (/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/.test(name)) return `${name} <${email}>`;
    if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
    return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?= <${email}>`;
}
