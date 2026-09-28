import oracledb from 'oracledb';

// The Oracle database the integration suites run against. The defaults match
// the gvenzl/oracle-free service of the `oracle` job in .github/workflows/ci.yml
// (APP_USER iskra in FREEPDB1); override with TEST_ORACLE_CONN,
// TEST_ORACLE_USER and TEST_ORACLE_PASSWORD.
export const ORACLE = {
    connectString: process.env.TEST_ORACLE_CONN || '127.0.0.1:1521/FREEPDB1',
    user: process.env.TEST_ORACLE_USER || 'iskra',
    password: process.env.TEST_ORACLE_PASSWORD || 'iskra',
};

/**
 * Whether the database accepts ORACLE's credentials: a real login and query,
 * not a TCP probe, so another service on the port skips the suites instead of
 * failing them. With TEST_ORACLE_REQUIRED set (the CI job), an unreachable
 * database throws: a skipped suite there would pass without testing anything.
 */
export async function oracleUp(): Promise<boolean> {
    let error: unknown;
    try {
        const conn = await oracledb.getConnection({ ...ORACLE, connectTimeout: 5 });
        try {
            await conn.execute('SELECT 1 FROM DUAL');
            return true;
        } finally {
            await conn.close();
        }
    } catch (err) {
        error = err;
    }
    if (process.env.TEST_ORACLE_REQUIRED) {
        throw new Error(`Oracle is not reachable at ${ORACLE.connectString} as ${ORACLE.user}`, { cause: error });
    }
    return false;
}
