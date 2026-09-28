import { search, sortBy, type Generated, type OracleDriver, type Page } from '@iskra-bun/db-oracle';

/** The Oracle tables of the example (migrations/oracle), as Kysely types. */
export interface OracleDB {
    APP_USERS: { ID: Generated<number>; NAME: string; CREATED: Date };
}

export interface ListParams {
    q?: string;
    sort?: string;
    page?: string;
    pageSize?: string;
}

export class OracleUserService {
    constructor(private oracle: OracleDriver<OracleDB>) {}

    /** False when ORA_CONN is not set: the OracleDriver did not start. */
    get available(): boolean {
        return this.oracle.db !== undefined;
    }

    /**
     * One page of users whose name contains `q` (ignoring case), sorted by
     * `sort` (`name` or `-name`, then by id). Throws a QueryInputError for a
     * sort field that is not allowed.
     */
    async list(params: ListParams): Promise<Page<{ ID: number; NAME: string }>> {
        let query = this.oracle.db!.selectFrom('APP_USERS').select(['ID', 'NAME']);
        query = search(query, ['NAME'], params.q);
        query = sortBy(query, params.sort?.toUpperCase(), ['NAME']).orderBy('ID');
        return this.oracle.paginate(query, { page: params.page, pageSize: params.pageSize });
    }
}
