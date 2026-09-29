import net from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import { Client, ResultCodeError } from 'ldapts';

/**
 * The LDAP operations ldap-kit needs, whatever client does them. ldap-kit's
 * API never shows the client's own types: `ldaptsTransport` (the default)
 * can be replaced (another client, a fake in tests) without changing it.
 */
export interface LdapTransport {
    /** A simple bind: an empty password must be refused before it gets here. */
    bind(dn: string, password: string): Promise<void>;
    /** Every entry of a search, page by page when `pageSize` is set. */
    search(base: string, options: TransportSearch): AsyncIterable<TransportEntry[]>;
    /** Ends the session and closes the connection. */
    close(): Promise<void>;
}

export interface TransportSearch {
    scope: 'base' | 'one' | 'sub';
    /** An RFC 4515 filter. */
    filter: string;
    /** The attributes to return; `[]` for all user attributes. */
    attributes: readonly string[];
    /** Attributes whose values are bytes (`objectGUID`, `objectSid`), not text. */
    binaryAttributes: readonly string[];
    /** Asks for pages of this size (the paged results control), or one result. */
    pageSize?: number;
    /** At most this many entries (0: the server's limit). */
    sizeLimit?: number;
}

/** An entry as the server sent it: text values, and bytes for the binary attributes. */
export interface TransportEntry {
    dn: string;
    attributes: Record<string, Array<string | Uint8Array>>;
}

/** Where and how to connect. */
export interface TransportOptions {
    /** `ldap://host:389` or `ldaps://host:636`. */
    url: string;
    /** Upgrades an `ldap://` connection with StartTLS before anything else. */
    startTLS: boolean;
    tls?: ConnectionOptions;
    connectTimeoutMs: number;
    timeoutMs: number;
}

/** Opens a connection: `ldaptsTransport` by default. */
export type LdapTransportFactory = (options: TransportOptions) => Promise<LdapTransport>;

/**
 * An LDAP result the server answered with: `resultCode` 49 is invalid
 * credentials, and Active Directory puts the reason in the message
 * (`data 52e`, `data 775`…).
 */
export class LdapResultError extends Error {
    constructor(
        readonly resultCode: number,
        message: string,
    ) {
        super(message);
        this.name = 'LdapResultError';
    }
}

/** An operation or a connection took longer than its timeout (the connection is closed). */
export class LdapTimeoutError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'LdapTimeoutError';
    }
}

/**
 * An ldapts error as a transport's: a server result keeps its code, a
 * timeout is an `LdapTimeoutError`; the rest (network, TLS) as they are.
 */
function translate(error: unknown): unknown {
    if (error instanceof ResultCodeError) return new LdapResultError(error.code, error.message);
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) {
        return new LdapTimeoutError(error.message, { cause: error });
    }
    return error;
}

const asArray = (value: unknown): Array<string | Uint8Array> =>
    (Array.isArray(value) ? value : [value]).filter(
        (v): v is string | Uint8Array => typeof v === 'string' || v instanceof Uint8Array,
    );

/** The default transport, over ldapts. */
export const ldaptsTransport: LdapTransportFactory = async (options) => {
    /** The plain socket, to close it when StartTLS fails halfway (unbind would wait for the timeout). */
    let plain: net.Socket | undefined;
    const client = new Client({
        url: options.url,
        connectTimeout: options.connectTimeoutMs,
        timeout: options.timeoutMs,
        createConnection: ((...args: Parameters<typeof net.connect>) =>
            (plain = net.connect(...args))) as typeof net.connect,
        // ldapts connects with TLS whenever it has tlsOptions: only for ldaps://,
        // StartTLS gets them when it upgrades the plain connection.
        ...(options.tls && /^ldaps:/i.test(options.url) ? { tlsOptions: { ...options.tls } } : {}),
    });
    try {
        // A copy: ldapts sets the upgraded socket on the options it is given,
        // and a later connection reusing them would wait on that dead socket.
        if (options.startTLS) await client.startTLS({ ...options.tls });
    } catch (error) {
        plain?.destroy();
        await client.unbind().catch(() => undefined);
        throw translate(error);
    }
    return {
        async bind(dn, password) {
            try {
                await client.bind(dn, password);
            } catch (error) {
                throw translate(error);
            }
        },
        search(base, search) {
            const request = {
                scope: search.scope,
                filter: search.filter,
                attributes: [...search.attributes],
                explicitBufferAttributes: [...search.binaryAttributes],
                ...(search.sizeLimit ? { sizeLimit: search.sizeLimit } : {}),
                ...(search.pageSize ? { paged: { pageSize: search.pageSize } } : {}),
            };
            return (async function* () {
                try {
                    if (!search.pageSize) {
                        const { searchEntries } = await client.search(base, request);
                        yield searchEntries.map(toEntry);
                        return;
                    }
                    for await (const page of client.searchPaginated(base, request)) {
                        yield page.searchEntries.map(toEntry);
                    }
                } catch (error) {
                    throw translate(error);
                }
            })();
        },
        async close() {
            await client.unbind().catch(() => undefined);
        },
    };
};

function toEntry(entry: { dn: string; [name: string]: unknown }): TransportEntry {
    const { dn, ...rest } = entry;
    return {
        dn,
        attributes: Object.fromEntries(Object.entries(rest).map(([name, value]) => [name, asArray(value)])),
    };
}
