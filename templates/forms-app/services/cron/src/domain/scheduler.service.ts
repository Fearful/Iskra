import { forms } from '@forms-app/shared/db';
import { eq, and, lte, or, isNull } from 'drizzle-orm';
import { FormStatus } from '@forms-app/shared';
import { internalApiHeaders } from '@forms-app/shared/internal-api';
import { config } from '../app.config.ts';
import type { FormsDb } from '@forms-app/shared/db/client';

/** A POST to form-manager's /internal API, which requires the internal token. */
function formManager(path: string, body: unknown): Promise<Response> {
    return fetch(`${config.formManagerUrl}/internal/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalApiHeaders(config.internalApiToken) },
        body: JSON.stringify(body),
    });
}

export class SchedulerService {
    private static db: FormsDb;

    static setDb(db: FormsDb) {
        this.db = db;
    }

    static async checkAndOpenForms(): Promise<number> {
        const now = new Date();

        // Find forms that should be opened: scheduled AND (no start date, or
        // starts_at <= now). Without a start date a form never opened: NULL
        // <= now is not true in SQL.
        const formsToOpen = await this.db
            .select()
            .from(forms)
            .where(and(eq(forms.status, FormStatus.SCHEDULED), or(isNull(forms.startsAt), lte(forms.startsAt, now))));

        let opened = 0;
        for (const form of formsToOpen) {
            try {
                const res = await formManager('lifecycle/open', { formId: form.id });

                if (res.ok) {
                    opened++;
                    console.log(`Opened form: ${form.id} (${form.title})`);
                } else {
                    const err = await res.text();
                    console.error(`Failed to open form ${form.id}:`, err);
                }
            } catch (err) {
                console.error(`Error opening form ${form.id}:`, err);
            }
        }

        return opened;
    }

    static async checkAndCloseForms(): Promise<number> {
        const now = new Date();

        // Find forms that should be closed: open AND ends_at <= now
        const formsToClose = await this.db
            .select()
            .from(forms)
            .where(and(eq(forms.status, FormStatus.OPEN), lte(forms.endsAt, now)));

        let closed = 0;
        for (const form of formsToClose) {
            try {
                const res = await formManager('lifecycle/close', { formId: form.id });

                if (res.ok) {
                    closed++;
                    console.log(`Closed form: ${form.id} (${form.title})`);
                } else {
                    const err = await res.text();
                    console.error(`Failed to close form ${form.id}:`, err);
                }
            } catch (err) {
                console.error(`Error closing form ${form.id}:`, err);
            }
        }

        return closed;
    }

    static async runCycle(): Promise<void> {
        const opened = await this.checkAndOpenForms();
        const closed = await this.checkAndCloseForms();

        if (opened > 0 || closed > 0) {
            console.log(`Cycle complete: ${opened} opened, ${closed} closed`);
        }
    }
}
