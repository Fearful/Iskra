import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test';
import { internalApiHeaders } from '@forms-app/shared/internal-api';
import { config } from '../src/app.config.ts';
import router from '../src/interfaces/http/router.ts';
import { LifecycleService } from '../src/domain/lifecycle/lifecycle.service.ts';
import { PrerenderService } from '../src/domain/prerender/prerender.service.ts';

// The /internal routes pre-render, open, close and remove forms (remove
// deletes the published page): they used to answer any request.
describe("form-manager's /internal API", () => {
    const removeForm = spyOn(LifecycleService, 'removeForm').mockResolvedValue(undefined);
    const openForm = spyOn(LifecycleService, 'openForm').mockResolvedValue(undefined);
    const prerenderForm = spyOn(PrerenderService, 'prerenderForm').mockResolvedValue({ outputDir: '/x' });

    afterEach(() => {
        removeForm.mockClear();
        openForm.mockClear();
        prerenderForm.mockClear();
    });

    // The services are shared with the other test files.
    afterAll(() => {
        removeForm.mockRestore();
        openForm.mockRestore();
        prerenderForm.mockRestore();
    });

    const remove = (headers: Record<string, string>) =>
        router.request('/internal/lifecycle/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ spaceSlug: 'space', formSlug: 'form' }),
        });

    it('refuses a request without the token', async () => {
        expect((await remove({})).status).toBe(401);
        expect((await router.request('/internal/prerender/f1', { method: 'POST' })).status).toBe(401);
        const open = await router.request('/internal/lifecycle/open', {
            method: 'POST',
            body: JSON.stringify({ formId: 'f1' }),
        });
        expect(open.status).toBe(401);
        expect(removeForm).not.toHaveBeenCalled();
        expect(prerenderForm).not.toHaveBeenCalled();
        expect(openForm).not.toHaveBeenCalled();
    });

    it('refuses a wrong token', async () => {
        expect((await remove(internalApiHeaders('not-the-token'))).status).toBe(401);
        expect((await remove(internalApiHeaders(`${config.internalApiToken}x`))).status).toBe(401);
        expect((await remove({ Authorization: config.internalApiToken })).status).toBe(401);
        expect(removeForm).not.toHaveBeenCalled();
    });

    it('runs the request with the token', async () => {
        const res = await remove(internalApiHeaders(config.internalApiToken));
        expect(res.status).toBe(200);
        expect(removeForm).toHaveBeenCalledWith('space', 'form');

        const prerender = await router.request('/internal/prerender/f1', {
            method: 'POST',
            headers: internalApiHeaders(config.internalApiToken),
        });
        expect(prerender.status).toBe(200);
        expect(prerenderForm).toHaveBeenCalledWith('f1');
    });
});
