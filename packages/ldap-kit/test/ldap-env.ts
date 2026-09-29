import { readFileSync } from 'node:fs';
import { Client } from 'ldapts';

// The OpenLDAP server the conformance suite runs against. The defaults match
// the osixia/openldap service of the `ldap` job in .github/workflows/ci.yml
// (domain iskra.test, admin/admin, a readonly/readonly service account);
// override with TEST_LDAP_URL, TEST_LDAP_ADMIN_PASSWORD and friends.
export const LDAP = {
    url: process.env.TEST_LDAP_URL || 'ldap://127.0.0.1:3389',
    root: 'dc=iskra,dc=test',
    adminDN: 'cn=admin,dc=iskra,dc=test',
    adminPassword: process.env.TEST_LDAP_ADMIN_PASSWORD || 'admin',
    bindDN: 'cn=readonly,dc=iskra,dc=test',
    bindPassword: process.env.TEST_LDAP_READONLY_PASSWORD || 'readonly',
    /** ldaps:// of the same server, with its CA file: the TLS test runs when both are set. */
    ldapsUrl: process.env.TEST_LDAPS_URL,
    ca: process.env.TEST_LDAP_CA ? readFileSync(process.env.TEST_LDAP_CA) : undefined,
    servername: process.env.TEST_LDAP_SERVERNAME || 'ldap.iskra.test',
};

/**
 * Whether the server accepts the admin's bind: with TEST_LDAP_REQUIRED set
 * (the CI job), an unreachable server throws instead of skipping the suite.
 */
export async function ldapUp(): Promise<boolean> {
    const client = new Client({ url: LDAP.url, connectTimeout: 3000, timeout: 5000 });
    let error: unknown;
    try {
        await client.bind(LDAP.adminDN, LDAP.adminPassword);
        return true;
    } catch (err) {
        error = err;
    } finally {
        await client.unbind().catch(() => undefined);
    }
    if (process.env.TEST_LDAP_REQUIRED) {
        throw new Error(`LDAP is not reachable at ${LDAP.url} as ${LDAP.adminDN}`, { cause: error });
    }
    return false;
}

/** An admin connection, to seed and clean up the suite's entries. */
export async function adminClient(): Promise<Client> {
    const client = new Client({ url: LDAP.url, timeout: 10_000 });
    await client.bind(LDAP.adminDN, LDAP.adminPassword);
    return client;
}
