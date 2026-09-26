import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { SchedulerService } from '../src/domain/scheduler.service.ts';
import { config } from '../src/app.config.ts';
import type { FormsDb } from '@forms-app/shared/db/client';

/** A Drizzle-ish db whose every select() returns `rows`. */
const fakeDb = (rows: unknown[]) => ({ select: () => ({ from: () => ({ where: async () => rows }) }) });

describe("cron's calls to form-manager", () => {
    const spies: { mockRestore(): void }[] = [];

    afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

    it('send the internal API token', async () => {
        // form-manager's /internal API requires it: it used to answer anyone.
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
            (async (_input: string | URL | Request, _init?: RequestInit) => new Response('{}')) as typeof fetch,
        );
        const logSpy = spyOn(console, 'log').mockImplementation(() => {});
        spies.push(fetchSpy, logSpy);
        SchedulerService.setDb(fakeDb([{ id: 'form-1', title: 'F' }]) as unknown as FormsDb);

        expect(await SchedulerService.checkAndOpenForms()).toBe(1);
        expect(await SchedulerService.checkAndCloseForms()).toBe(1);

        const calls = fetchSpy.mock.calls as unknown as [string, RequestInit][];
        expect(calls.map(([url]) => url)).toEqual([
            `${config.formManagerUrl}/internal/lifecycle/open`,
            `${config.formManagerUrl}/internal/lifecycle/close`,
        ]);
        for (const [, init] of calls) {
            expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${config.internalApiToken}`);
            expect(JSON.parse(String(init.body))).toEqual({ formId: 'form-1' });
        }
    });
});
