import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { transformJsonSchemaToZod } from "../src/transform";

// The generated module is bundled into every public form page, so values
// from the schema (patterns, messages, keys) must not be able to escape their
// literals and run as code.
function load(code: string) {
    const body = code
        .replace("import { z } from 'zod';", "")
        .replace("export const formSchema =", "return");
    return new Function("z", body)(z) as z.ZodTypeAny;
}

describe("generated schema module", () => {
    it("keeps a pattern inside its regex", () => {
        const g = globalThis as { pwned?: number };
        delete g.pwned;
        const schema = load(transformJsonSchemaToZod({
            type: "object",
            // A valid regex that, spliced into /.../, closes the literal and runs code.
            properties: { code: { type: "string", pattern: "a/.test(''), globalThis.pwned = 1, /b" } },
            required: ["code"],
        }, { typeExport: false }));
        expect(g.pwned).toBeUndefined();
        expect(schema.safeParse({ code: "a/xtest'', globalThis.pwned = 1, /b" }).success).toBe(true);
        expect(schema.safeParse({ code: "b" }).success).toBe(false);
    });

    it("keeps messages inside their string literals", () => {
        const message = "it's\\r\n\r  '); globalThis.pwned = 1; ('";
        const schema = load(transformJsonSchemaToZod({
            type: "object",
            properties: { name: { type: "string", minLength: 3, errorMessage: { minLength: message } } },
            required: ["name"],
        } as any, { typeExport: false }));
        const result = schema.safeParse({ name: "x" });
        expect(result.success).toBe(false);
        expect(result.error!.issues[0].message).toBe(message);
    });

    it("quotes keys that are not identifiers", () => {
        const schema = load(transformJsonSchemaToZod({
            type: "object",
            properties: { "first-name": { type: "string" }, "a: z.never(), b": { type: "string" } },
            required: ["first-name"],
        }, { typeExport: false }));
        expect(schema.safeParse({ "first-name": "Ada" }).success).toBe(true);
    });
});
