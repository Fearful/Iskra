import { describe, expect, it } from 'bun:test';
import answersRoutes from '../src/interfaces/http/answers.routes.ts';
import { FormService } from '../src/domain/forms/form.service.ts';

/** A Drizzle-ish db that records the LIMIT and OFFSET of the answers query, as Postgres would reject them. */
function fakeDb() {
    const db = {
        limit: undefined as number | undefined,
        offset: undefined as number | undefined,
        select: (fields?: unknown) => ({
            from: () => ({
                where: () =>
                    fields
                        ? Promise.resolve([{ count: 3 }])
                        : {
                              orderBy: () => ({
                                  limit: (limit: number) => ({
                                      offset: async (offset: number) => {
                                          db.limit = limit;
                                          db.offset = offset;
                                          // Postgres: "OFFSET must not be negative", and so on.
                                          for (const n of [limit, offset]) {
                                              if (!Number.isSafeInteger(n) || n < 0) throw new Error(`bad ${n}`);
                                          }
                                          return [];
                                      },
                                  }),
                              }),
                          },
            }),
        }),
    };
    return db;
}

describe('GET /forms/:id/answers', () => {
    const query = async (search: string) => {
        const db = fakeDb();
        FormService.setDb(db);
        const res = await answersRoutes.request(`/forms/form-1/answers${search}`);
        return { status: res.status, body: (await res.json()) as any, limit: db.limit, offset: db.offset };
    };

    it('pages as asked', async () => {
        expect(await query('?page=3&pageSize=20')).toMatchObject({
            status: 200,
            body: { page: 3, pageSize: 20, total: 3 },
            limit: 20,
            offset: 40,
        });
    });

    it('clamps a page below 1 and a page size outside 1..100', async () => {
        // page=-1 made a negative OFFSET: a 500 from Postgres.
        expect(await query('?page=-1')).toMatchObject({ status: 200, body: { page: 1 }, offset: 0 });
        expect(await query('?page=0&pageSize=0')).toMatchObject({ status: 200, limit: 1, offset: 0 });
        expect(await query('?pageSize=-5')).toMatchObject({ status: 200, limit: 1 });
        expect(await query('?pageSize=5000')).toMatchObject({ status: 200, body: { pageSize: 100 }, limit: 100 });
    });

    it('uses the defaults for missing values or values that are not numbers', async () => {
        expect(await query('')).toMatchObject({ status: 200, body: { page: 1, pageSize: 50 }, limit: 50, offset: 0 });
        expect(await query('?page=abc&pageSize=xyz')).toMatchObject({ status: 200, limit: 50, offset: 0 });
        expect(await query('?page=Infinity&pageSize=NaN')).toMatchObject({ status: 200, limit: 50, offset: 0 });
    });

    it('rounds fractions down and keeps a huge page a safe OFFSET', async () => {
        expect(await query('?page=2.7&pageSize=33.9')).toMatchObject({ status: 200, limit: 33, offset: 33 });
        const huge = await query('?page=1e300&pageSize=100');
        expect(huge.status).toBe(200);
        expect(Number.isSafeInteger(huge.offset)).toBe(true);
    });
});
