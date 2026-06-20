import type { EmailAdapter, EmailConfig, EmailMessage, TemplateData } from "../types";

/**
 * Minimal structural shape of the value returned by
 * `@aws-sdk/client-sesv2`'s `SendEmailCommand` constructor. We only need
 * an opaque object to hand back to `client.send`, so typing it as an
 * unknown-bearing record keeps `tsc` happy without the SDK installed.
 */
export interface SesCommand {
    readonly input: unknown;
}

/**
 * Structural type for the SESv2 client. Declared locally so this module
 * type-checks even when `@aws-sdk/client-sesv2` is not installed; the real
 * SDK client satisfies this shape at runtime.
 */
export interface SesClient {
    send(command: SesCommand): Promise<{ MessageId?: string }>;
}

/** Factory that builds a `SendEmailCommand` from its input object. */
export type SesCommandFactory = (input: unknown) => SesCommand;

export interface SesAdapterDeps {
    /** Pre-built client (used by tests to avoid importing the real SDK). */
    client?: SesClient;
    /** Pre-built command factory (used by tests to avoid importing the real SDK). */
    sendEmailCommand?: SesCommandFactory;
}

export class SesEmailAdapter implements EmailAdapter {
    private region?: string;
    private defaultFrom?: { name?: string; email: string };
    private injectedClient?: SesClient;
    private injectedCommand?: SesCommandFactory;

    constructor(config: EmailConfig, deps: SesAdapterDeps = {}) {
        // The effective `from` address is validated at send time (it can come
        // from the message or the config), so construction stays permissive.
        this.region = config.region;
        this.defaultFrom = config.from;
        this.injectedClient = deps.client;
        this.injectedCommand = deps.sendEmailCommand;
    }

    private async resolveSdk(): Promise<{ client: SesClient; command: SesCommandFactory }> {
        if (this.injectedClient && this.injectedCommand) {
            return { client: this.injectedClient, command: this.injectedCommand };
        }

        // Lazy load only when actually sending so `tsc`/`bun test` stay green
        // without `@aws-sdk/client-sesv2` installed. The specifier is held in a
        // variable so TypeScript does not try to resolve the module at compile
        // time (it is a real runtime dependency, declared in package.json).
        const sdkModule = "@aws-sdk/client-sesv2";
        const mod: any = await import(sdkModule);
        const SESv2Client = mod.SESv2Client as new (cfg: { region?: string }) => SesClient;
        const SendEmailCommand = mod.SendEmailCommand as new (input: unknown) => SesCommand;

        const client = this.injectedClient ?? new SESv2Client({ region: this.region });
        const command: SesCommandFactory = this.injectedCommand ?? ((input) => new SendEmailCommand(input));

        return { client, command };
    }

    async send(message: EmailMessage): Promise<{ messageId: string; success: boolean }> {
        const from = message.from || this.defaultFrom;
        if (!from) throw new Error("From address required");

        const { client, command } = await this.resolveSdk();

        const toAddresses = Array.isArray(message.to) ? message.to : [message.to];
        const ccAddresses = message.cc ? (Array.isArray(message.cc) ? message.cc : [message.cc]) : undefined;
        const bccAddresses = message.bcc ? (Array.isArray(message.bcc) ? message.bcc : [message.bcc]) : undefined;

        const body: Record<string, { Data: string; Charset: string }> = {};
        if (message.text) body.Text = { Data: message.text, Charset: "UTF-8" };
        if (message.html) body.Html = { Data: message.html, Charset: "UTF-8" };

        const input = {
            FromEmailAddress: from.name ? `${from.name} <${from.email}>` : from.email,
            Destination: {
                ToAddresses: toAddresses,
                ...(ccAddresses ? { CcAddresses: ccAddresses } : {}),
                ...(bccAddresses ? { BccAddresses: bccAddresses } : {}),
            },
            ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
            Content: {
                Simple: {
                    Subject: { Data: message.subject, Charset: "UTF-8" },
                    Body: body,
                },
            },
        };

        const result = await client.send(command(input));
        return { messageId: result.MessageId ?? "", success: true };
    }

    async sendTemplate(templateName: string, to: string | string[], data: TemplateData): Promise<{ messageId: string; success: boolean }> {
        return this.send({
            to,
            subject: `Template: ${templateName}`,
            html: `<p>Template ${templateName} rendered with ${JSON.stringify(data)}</p>`,
        });
    }
}
