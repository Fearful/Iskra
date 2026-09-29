/**
 * Active Directory's binary and numeric attributes as values: GUIDs, SIDs,
 * FILETIMEs, GeneralizedTimes and userAccountControl's flags.
 */

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * An `objectGUID` (16 bytes) as text: `1a2b3c4d-…`. Its first three groups
 * are little-endian, as Windows writes a GUID.
 */
export function decodeGuid(bytes: Uint8Array): string {
    if (bytes.length !== 16) throw new TypeError(`A GUID has 16 bytes, not ${bytes.length}`);
    const reversed = (from: number, to: number) => hex(bytes.slice(from, to).reverse());
    return [reversed(0, 4), reversed(4, 6), reversed(6, 8), hex(bytes.slice(8, 10)), hex(bytes.slice(10, 16))].join(
        '-',
    );
}

/** A GUID's text as the bytes AD stores (to search by `objectGUID`). */
export function encodeGuid(guid: string): Uint8Array {
    const clean = guid.replace(/[{}-]/g, '');
    if (!/^[0-9a-f]{32}$/i.test(clean)) throw new TypeError(`Not a GUID: ${guid}`);
    const bytes = Uint8Array.from(clean.match(/../g)!, (pair) => parseInt(pair, 16));
    bytes.subarray(0, 4).reverse();
    bytes.subarray(4, 6).reverse();
    bytes.subarray(6, 8).reverse();
    return bytes;
}

/** Bytes for a filter: `\\1a\\2b…`, to search a binary attribute. */
export function filterBytes(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => `\\${b.toString(16).padStart(2, '0')}`).join('');
}

/** An `objectSid` as text: `S-1-5-21-…-1104`. */
export function decodeSid(bytes: Uint8Array): string {
    if (bytes.length < 8) throw new TypeError('A SID has at least 8 bytes');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const revision = bytes[0]!;
    const count = bytes[1]!;
    // The identifier authority: 48 bits, big-endian.
    const authority = view.getUint16(2) * 2 ** 32 + view.getUint32(4);
    const parts = [`S-${revision}-${authority}`];
    for (let i = 0; i < count; i++) parts.push(String(view.getUint32(8 + i * 4, true)));
    return parts.join('-');
}

/** Windows FILETIME: 100 ns ticks since 1601-01-01. 0 and the maximum mean "never". */
export function decodeFileTime(value: string | bigint): Date | null {
    const ticks = typeof value === 'bigint' ? value : BigInt(value);
    if (ticks <= 0n || ticks >= 0x7fffffffffffffffn) return null;
    return new Date(Number(ticks / 10_000n - 11_644_473_600_000n));
}

/** A GeneralizedTime (`20240131235959.0Z`, `20240131235959Z`) as a Date. */
export function decodeGeneralizedTime(value: string): Date | null {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(?:[.,](\d+))?(Z|[+-]\d{2}(?:\d{2})?)?$/.exec(value);
    if (!match) return null;
    const [, y, mo, d, h, mi = '00', s = '00', fraction = '0', zone = 'Z'] = match;
    const ms = Math.round(Number(`0.${fraction}`) * 1000);
    let time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
    if (zone !== 'Z') {
        const sign = zone.startsWith('-') ? -1 : 1;
        const offset = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5) || 0);
        time -= sign * offset * 60_000;
    }
    return new Date(time);
}

/** userAccountControl's flags that matter to a login. */
export const AccountFlags = {
    ACCOUNTDISABLE: 0x2,
    LOCKOUT: 0x10,
    PASSWD_NOTREQD: 0x20,
    NORMAL_ACCOUNT: 0x200,
    DONT_EXPIRE_PASSWORD: 0x10000,
    PASSWORD_EXPIRED: 0x800000,
} as const;

/** What userAccountControl says about an account. */
export interface AccountControl {
    disabled: boolean;
    /** The flag is often stale in AD: `lockoutTime` is the reliable source (see `LdapUser.locked`). */
    lockedOut: boolean;
    passwordNeverExpires: boolean;
    passwordExpired: boolean;
    raw: number;
}

export function decodeAccountControl(value: number | string): AccountControl {
    const raw = Number(value);
    return {
        disabled: (raw & AccountFlags.ACCOUNTDISABLE) !== 0,
        lockedOut: (raw & AccountFlags.LOCKOUT) !== 0,
        passwordNeverExpires: (raw & AccountFlags.DONT_EXPIRE_PASSWORD) !== 0,
        passwordExpired: (raw & AccountFlags.PASSWORD_EXPIRED) !== 0,
        raw,
    };
}
