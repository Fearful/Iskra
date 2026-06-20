import { describe, expect, it, afterEach, spyOn } from "bun:test";
import * as nodemailer from "nodemailer";
import { SmtpEmailAdapter } from "../src/providers/smtp";

/**
 * RED — Finding: MEDIUM SMTP TLS.
 *
 * `secure` currently defaults to `false` with no `requireTLS`/`tls` options,
 * so credentials can transit in cleartext.
 *
 * Desired fixed behavior for the transport options:
 *   - port 465  -> secure: true  (implicit TLS)
 *   - other ports (e.g. 587) -> secure: false but requireTLS: true (STARTTLS enforced)
 *   - an explicit `secure: true` in config is honored
 *   - tls.rejectUnauthorized is surfaced and defaults to true
 *
 * These tests capture the options passed to nodemailer.createTransport.
 * They FAIL today because the adapter only sets `secure` and never sets
 * `requireTLS` or `tls`.
 */
describe("SMTP transport TLS hardening", () => {
    let createSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        createSpy?.mockRestore();
        createSpy = null;
    });

    function capture() {
        createSpy = spyOn(nodemailer, "createTransport").mockReturnValue({
            sendMail: async () => ({ messageId: "x" }),
        } as any);
    }

    function optionsFor(smtp: { host: string; port: number; username: string; password: string; secure?: boolean }) {
        new SmtpEmailAdapter({ provider: "smtp", smtp, from: { email: "no-reply@iskra.dev" } });
        return createSpy!.mock.calls[0]![0] as any;
    }

    it("defaults to secure:true for port 465 (implicit TLS)", () => {
        capture();
        const opts = optionsFor({ host: "smtp.example.com", port: 465, username: "u", password: "p" });
        expect(opts.secure).toBe(true);
    });

    it("uses secure:false but requireTLS:true for non-465 ports (e.g. 587 STARTTLS)", () => {
        capture();
        const opts = optionsFor({ host: "smtp.example.com", port: 587, username: "u", password: "p" });
        expect(opts.secure).toBe(false);
        expect(opts.requireTLS).toBe(true);
    });

    it("honors an explicit secure:true override from config", () => {
        capture();
        const opts = optionsFor({ host: "smtp.example.com", port: 2525, username: "u", password: "p", secure: true });
        expect(opts.secure).toBe(true);
    });

    it("surfaces tls.rejectUnauthorized defaulting to true", () => {
        capture();
        const opts = optionsFor({ host: "smtp.example.com", port: 587, username: "u", password: "p" });
        expect(opts.tls).toBeDefined();
        expect(opts.tls.rejectUnauthorized).toBe(true);
    });
});
