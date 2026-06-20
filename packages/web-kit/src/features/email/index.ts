import type { Feature } from "../../types";
import type { Kernel } from "../../kernel";
import type { Context, Next } from "hono";
import { createEmailAdapter } from "@iskra-bun/mailer-kit";

export type { EmailConfig, EmailMessage, TemplateData, EmailAdapter } from "@iskra-bun/mailer-kit";
export { MockEmailAdapter } from "@iskra-bun/mailer-kit";

import type { EmailConfig, EmailAdapter } from "@iskra-bun/mailer-kit";

declare module "hono" {
    interface ContextVariableMap {
        email: EmailAdapter;
    }
}

export class EmailFeature implements Feature {
    name = "email";
    private adapter?: EmailAdapter;

    constructor(private config: EmailConfig) { }

    async initialize(kernel: Kernel): Promise<void> {
        this.adapter = await createEmailAdapter(this.config);
        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            if (this.adapter) c.set("email", this.adapter);
            await next();
        });
    }

    getAdapter(): EmailAdapter {
        if (!this.adapter) throw new Error("Email not initialized");
        return this.adapter;
    }
}
