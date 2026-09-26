import { forms, spaces } from '@forms-app/shared/db';
import { eq, or } from 'drizzle-orm';
import { FormStatus, REDIS_KEYS } from '@forms-app/shared';
import type { FormsDb, FormsRedis } from '@forms-app/shared/db/client';

export class RedisPopulatorService {
    private static db: FormsDb;
    private static redis: Pick<FormsRedis, 'set' | 'del' | 'sadd'> | undefined;

    static setDb(db: FormsDb) {
        this.db = db;
    }

    static setRedis(redis: Pick<FormsRedis, 'set' | 'del' | 'sadd'>) {
        this.redis = redis;
    }

    static async populateActiveForms(): Promise<number> {
        if (!this.redis) {
            console.warn('Redis not available, skipping population');
            return 0;
        }

        // Get all open and scheduled forms with their spaces
        const activeForms = await this.db
            .select({
                formId: forms.id,
                formSlug: forms.slug,
                formStatus: forms.status,
                validationSchema: forms.validationSchema,
                startsAt: forms.startsAt,
                endsAt: forms.endsAt,
                spaceSlug: spaces.slug,
            })
            .from(forms)
            .innerJoin(spaces, eq(forms.spaceId, spaces.id))
            .where(or(eq(forms.status, FormStatus.OPEN), eq(forms.status, FormStatus.SCHEDULED)));

        let populated = 0;
        const activeKeys: string[] = [];

        for (const form of activeForms) {
            if (!form.validationSchema) continue;

            const schemaKey = REDIS_KEYS.formSchema(form.spaceSlug, form.formSlug);
            const metaKey = REDIS_KEYS.formMeta(form.spaceSlug, form.formSlug);

            await this.redis.set(schemaKey, JSON.stringify(form.validationSchema));
            await this.redis.set(
                metaKey,
                JSON.stringify({
                    formId: form.formId,
                    status: form.formStatus,
                    startsAt: form.startsAt?.toISOString() ?? null,
                    endsAt: form.endsAt?.toISOString() ?? null,
                }),
            );

            activeKeys.push(`${form.spaceSlug}:${form.formSlug}`);
            populated++;
        }

        // Update the active index
        if (activeKeys.length > 0) {
            await this.redis.del(REDIS_KEYS.formIndex);
            await this.redis.sadd(REDIS_KEYS.formIndex, ...activeKeys);
        }

        console.log(`Populated ${populated} active forms in Redis`);
        return populated;
    }
}
