import type { TransportEntry } from './transport';
import { decodeFileTime, decodeGeneralizedTime, decodeGuid, decodeSid } from './decode';

const text = (value: string | Uint8Array) => (typeof value === 'string' ? value : new TextDecoder().decode(value));

/**
 * An entry of the directory: its DN and its attributes, read by name
 * ignoring case (`mail`, `MAIL`), as text, bytes or the value they encode.
 */
export class LdapEntry {
    private readonly byName: Map<string, { name: string; values: Array<string | Uint8Array> }>;

    constructor(entry: TransportEntry) {
        this.dn = entry.dn;
        this.byName = new Map(
            Object.entries(entry.attributes).map(([name, values]) => [name.toLowerCase(), { name, values }]),
        );
    }

    readonly dn: string;

    /** The attributes it has, as the server named them. */
    get attributeNames(): string[] {
        return [...this.byName.values()].map((a) => a.name);
    }

    has(name: string): boolean {
        return (this.byName.get(name.toLowerCase())?.values.length ?? 0) > 0;
    }

    /** The first value, as text. */
    get(name: string): string | undefined {
        const value = this.byName.get(name.toLowerCase())?.values[0];
        return value === undefined ? undefined : text(value);
    }

    /** Every value, as text. */
    getAll(name: string): string[] {
        return (this.byName.get(name.toLowerCase())?.values ?? []).map(text);
    }

    /** The first value's bytes (a binary attribute: ldap-kit reads `objectGUID`, `objectSid`… as bytes). */
    bytes(name: string): Uint8Array | undefined {
        const value = this.byName.get(name.toLowerCase())?.values[0];
        return value === undefined ? undefined : typeof value === 'string' ? new TextEncoder().encode(value) : value;
    }

    /** An integer attribute (`userAccountControl`). */
    number(name: string): number | undefined {
        const value = this.get(name);
        return value === undefined || value.trim() === '' || Number.isNaN(Number(value)) ? undefined : Number(value);
    }

    /** A 64-bit integer attribute (`uSNChanged`, a FILETIME). */
    bigint(name: string): bigint | undefined {
        const value = this.get(name);
        if (value === undefined) return undefined;
        try {
            return BigInt(value);
        } catch {
            return undefined;
        }
    }

    /** A GUID attribute (`objectGUID`) as text. */
    guid(name = 'objectGUID'): string | undefined {
        const bytes = this.bytes(name);
        return bytes?.length === 16 ? decodeGuid(bytes) : undefined;
    }

    /** A SID attribute (`objectSid`) as text. */
    sid(name = 'objectSid'): string | undefined {
        const bytes = this.bytes(name);
        try {
            return bytes ? decodeSid(bytes) : undefined;
        } catch {
            return undefined;
        }
    }

    /** A date: a GeneralizedTime (`whenChanged`, `modifyTimestamp`) or a FILETIME (`pwdLastSet`); null for "never". */
    date(name: string): Date | null | undefined {
        const value = this.get(name);
        if (value === undefined) return undefined;
        if (/^-?\d+$/.test(value)) return decodeFileTime(value);
        return decodeGeneralizedTime(value);
    }

    /** The attributes as text (bytes as base64), for logs and JSON. */
    toJSON(): { dn: string; attributes: Record<string, string[]> } {
        const attributes: Record<string, string[]> = {};
        for (const { name, values } of this.byName.values()) {
            attributes[name] = values.map((v) => (typeof v === 'string' ? v : Buffer.from(v).toString('base64')));
        }
        return { dn: this.dn, attributes };
    }
}
