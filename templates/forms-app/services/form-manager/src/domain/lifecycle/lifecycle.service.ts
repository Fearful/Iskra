import { rmSync } from 'fs';
import { join } from 'path';
import { forms, spaces } from '@forms-app/shared/db';
import { eq } from 'drizzle-orm';
import { config } from '../../app.config.ts';
import { REDIS_KEYS, FormStatus } from '@forms-app/shared';
import { PrerenderService } from '../prerender/prerender.service.ts';

export class LifecycleService {
    private static db: any;
    private static redis: any;

    static setDb(db: any) {
        this.db = db;
    }

    static setRedis(redis: any) {
        this.redis = redis;
    }

    static async openForm(formId: string): Promise<void> {
        const formResults = await this.db.select().from(forms).where(eq(forms.id, formId));
        const form = formResults[0];
        if (!form) throw new Error(`Form not found: ${formId}`);

        if (form.status !== FormStatus.SCHEDULED) {
            throw new Error(`Form is not scheduled, current status: ${form.status}`);
        }

        // Ensure form is prerendered
        const spaceResults = await this.db.select().from(spaces).where(eq(spaces.id, form.spaceId));
        const space = spaceResults[0];

        // Update status to open
        await this.db
            .update(forms)
            .set({ status: FormStatus.OPEN, updatedAt: new Date() })
            .where(eq(forms.id, formId));

        // Update Redis meta
        if (this.redis && space) {
            const metaKey = REDIS_KEYS.formMeta(space.slug, form.slug);
            await this.redis.set(
                metaKey,
                JSON.stringify({
                    formId: form.id,
                    status: FormStatus.OPEN,
                    startsAt: form.startsAt?.toISOString() ?? null,
                    endsAt: form.endsAt?.toISOString() ?? null,
                }),
            );
        }

        console.log(`Form ${formId} opened`);
    }

    static async closeForm(formId: string): Promise<void> {
        const formResults = await this.db.select().from(forms).where(eq(forms.id, formId));
        const form = formResults[0];
        if (!form) throw new Error(`Form not found: ${formId}`);

        if (form.status !== FormStatus.OPEN) {
            throw new Error(`Form is not open, current status: ${form.status}`);
        }

        const spaceResults = await this.db.select().from(spaces).where(eq(spaces.id, form.spaceId));
        const space = spaceResults[0];

        // Update status to closed
        await this.db
            .update(forms)
            .set({ status: FormStatus.CLOSED, updatedAt: new Date() })
            .where(eq(forms.id, formId));

        // Update Redis: set TTL for cleanup
        if (this.redis && space) {
            const schemaKey = REDIS_KEYS.formSchema(space.slug, form.slug);
            const metaKey = REDIS_KEYS.formMeta(space.slug, form.slug);

            await this.redis.set(
                metaKey,
                JSON.stringify({
                    formId: form.id,
                    status: FormStatus.CLOSED,
                    startsAt: form.startsAt?.toISOString() ?? null,
                    endsAt: form.endsAt?.toISOString() ?? null,
                }),
            );

            // Set TTL on closed form keys (1 hour)
            await this.redis.expire(schemaKey, 3600);
            await this.redis.expire(metaKey, 3600);

            // Remove from active index
            await this.redis.srem(REDIS_KEYS.formIndex, `${space.slug}:${form.slug}`);
        }

        console.log(`Form ${formId} closed`);
    }

    /**
     * Unpublishes the form at these slugs: its Redis schema and meta and its
     * static page. Called when a form is deleted; its keys used to stay, so
     * forms-api kept accepting answers the answer-writer could not store.
     */
    static async removeForm(spaceSlug: string, formSlug: string): Promise<void> {
        const slug = /^[a-z0-9][a-z0-9-]*$/i;
        if (!slug.test(spaceSlug) || !slug.test(formSlug)) {
            throw new Error('Invalid slug');
        }
        if (this.redis) {
            await this.redis.del(REDIS_KEYS.formSchema(spaceSlug, formSlug), REDIS_KEYS.formMeta(spaceSlug, formSlug));
            await this.redis.srem(REDIS_KEYS.formIndex, `${spaceSlug}:${formSlug}`);
        }
        rmSync(join(config.staticDir, spaceSlug, formSlug), { recursive: true, force: true });
        console.log(`Form ${spaceSlug}/${formSlug} removed`);
    }
}
