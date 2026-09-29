import {
    LdapResultError,
    type LdapTransport,
    type LdapTransportFactory,
    type TransportEntry,
    type TransportOptions,
    type TransportSearch,
} from '../src/index';

export interface FakeCall {
    op: 'bind' | 'search' | 'close';
    url: string;
    dn?: string;
    base?: string;
    search?: TransportSearch;
}

export interface FakeDirectory {
    /** Throws to refuse a bind (an `LdapResultError`), or to fail the connection. */
    bind?(dn: string, password: string, url: string): void;
    /** The pages a search answers. */
    search?(base: string, search: TransportSearch): TransportEntry[][] | TransportEntry[];
}

/** A transport answered by `directory`, recording every call. */
export function fakeTransport(directory: FakeDirectory): { factory: LdapTransportFactory; calls: FakeCall[] } {
    const calls: FakeCall[] = [];
    const factory: LdapTransportFactory = async (options: TransportOptions): Promise<LdapTransport> => {
        const url = options.url;
        return {
            async bind(dn, password) {
                calls.push({ op: 'bind', url, dn });
                directory.bind?.(dn, password, url);
            },
            search(base, search) {
                calls.push({ op: 'search', url, base, search });
                const answer = directory.search?.(base, search) ?? [];
                const pages = (answer.length > 0 && Array.isArray(answer[0]) ? answer : [answer]) as TransportEntry[][];
                return (async function* () {
                    for (const page of pages) yield page;
                })();
            },
            async close() {
                calls.push({ op: 'close', url });
            },
        };
    };
    return { factory, calls };
}

export const invalidCredentials = (data = '52e') =>
    new LdapResultError(
        49,
        `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${data}, v4563`,
    );

export const entry = (dn: string, attributes: Record<string, Array<string | Uint8Array>>): TransportEntry => ({
    dn,
    attributes,
});
