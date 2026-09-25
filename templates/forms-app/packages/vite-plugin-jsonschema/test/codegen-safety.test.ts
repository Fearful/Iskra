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

    it("refuses a number keyword that is not a number instead of writing it into the code", () => {
        const g = globalThis as { pwned?: string[] };
        const payload = "(globalThis.pwned = [...(globalThis.pwned ?? []), 'ran'], 5)";
        const cases: Array<[string, Record<string, unknown>]> = [
            ["minLength", { type: "string", minLength: payload }],
            ["maxLength", { type: "string", maxLength: payload }],
            ["minimum", { type: "number", minimum: payload }],
            ["maximum", { type: "integer", maximum: payload }],
            ["minItems", { type: "array", items: { enum: ["a"] }, minItems: payload }],
        ];
        delete g.pwned;
        for (const [keyword, prop] of cases) {
            expect(() =>
                transformJsonSchemaToZod({ type: "object", properties: { f: prop } } as any, { typeExport: false }),
            ).toThrow(`"${keyword}" must be`);
        }
        expect(g.pwned).toBeUndefined();

        // Lengths and item counts are integers; bounds may be fractional.
        expect(() =>
            transformJsonSchemaToZod({ type: "object", properties: { f: { type: "string", maxLength: 2.5 } } } as any),
        ).toThrow('"maxLength" must be an integer');
        const schema = load(transformJsonSchemaToZod({
            type: "object",
            properties: { price: { type: "number", minimum: 0.5, maximum: 1e3 } },
            required: ["price"],
        } as any, { typeExport: false }));
        expect(schema.safeParse({ price: 0.75 }).success).toBe(true);
        expect(schema.safeParse({ price: 0.25 }).success).toBe(false);
    });

    it("refuses a __proto__ property, which would vanish from the shape unvalidated", () => {
        // As read from a database JSON column: an own "__proto__" key.
        const properties = JSON.parse('{"__proto__": {"type": "string", "minLength": 3}}');
        expect(() =>
            transformJsonSchemaToZod({ type: "object", properties, required: ["__proto__"] } as any),
        ).toThrow('"__proto__" is not a valid property name');
    });

    it("builds a field named like an Object.prototype member", () => {
        const schema = load(transformJsonSchemaToZod({
            type: "object",
            properties: { constructor: { type: "string", minLength: 1 } },
            required: ["constructor"],
            errorMessage: { required: {} },
        } as any, { typeExport: false }));
        expect(schema.safeParse({ constructor: "x" }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });
});
