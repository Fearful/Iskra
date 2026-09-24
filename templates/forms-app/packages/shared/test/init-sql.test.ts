import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { generateInitSql, INIT_SQL_PATH } from '../scripts/init-sql';

// docker-compose creates the tables from db/init/01-schema.sql; it must match
// the Drizzle schema the services query.
describe('db/init/01-schema.sql', () => {
    it('matches src/db/schema.ts', async () => {
        expect(readFileSync(INIT_SQL_PATH, 'utf8')).toBe(await generateInitSql());
    }, 60_000);
});
