import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import formsRoutes from '../src/interfaces/http/forms.routes.ts';
import { config } from '../src/app.config.ts';

// form-manager's /internal API requires INTERNAL_API_TOKEN (it used to answer
// anyone): admin-api has to send it.
describe("admin-api's calls to form-manager", () => {
    let fetchSpy: ReturnType<typeof spyOn> | undefined;

    afterEach(() => fetchSpy?.mockRestore());

    it('send the internal API token', async () => {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { outputDir: '/x' } }));

        const res = await formsRoutes.request('/forms/form-1/prerender', { method: 'POST' });

        expect(res.status).toBe(200);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${config.formManagerUrl}/internal/prerender/form-1`);
        expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${config.internalApiToken}`);
    });

    it('keep the form id inside its path segment', async () => {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));

        await formsRoutes.request('/forms/..%2Flifecycle%2Fremove/prerender', { method: 'POST' });

        const [url] = fetchSpy.mock.calls[0] as [string];
        expect(url).toBe(`${config.formManagerUrl}/internal/prerender/..%2Flifecycle%2Fremove`);
    });
});
