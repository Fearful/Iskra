import { describe, it, expect } from "bun:test";
import { transformJsonSchemaToZod } from "../src/transform";

describe("transformJsonSchemaToZod", () => {
    it("wraps fields in a formSchema object and exports the inferred type", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { name: { type: "string" } },
            required: [],
        });
        expect(code).toContain("import { z } from 'zod';");
        expect(code).toContain("export const formSchema = z.object({");
        expect(code).toContain("export type FormData = z.infer<typeof formSchema>;");
    });

    it("marks required string fields and applies maxLength with an interpolated message", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: {
                name: { type: "string", maxLength: 5, errorMessage: { maxLength: "Max {max} chars", required: "Required!" } },
            },
            required: ["name"],
        });
        expect(code).toContain("name: z.string().max(5, 'Max 5 chars').min(1, 'Required!'),");
    });

    it("makes non-required fields optional", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { nick: { type: "string" } },
            required: [],
        });
        expect(code).toContain("nick: z.string().optional(),");
    });

    it("emits .email() with a custom or default message", () => {
        const custom = transformJsonSchemaToZod({
            type: "object",
            properties: { e: { type: "string", format: "email", errorMessage: { format: "Bad email" } } },
            required: ["e"],
        });
        expect(custom).toContain("z.string().email('Bad email')");

        const dflt = transformJsonSchemaToZod({
            type: "object",
            properties: { e: { type: "string", format: "email" } },
            required: ["e"],
        });
        expect(dflt).toContain("z.string().email('Please enter a valid email address')");
    });

    it("supports date and uri formats", () => {
        const date = transformJsonSchemaToZod({
            type: "object",
            properties: { d: { type: "string", format: "date" } },
            required: ["d"],
        });
        expect(date).toContain("z.string().date()");

        const uri = transformJsonSchemaToZod({
            type: "object",
            properties: { u: { type: "string", format: "uri" } },
            required: ["u"],
        });
        expect(uri).toContain("z.string().url()");
    });

    it("handles number and integer with min/max and interpolated messages", () => {
        const num = transformJsonSchemaToZod({
            type: "object",
            properties: {
                age: { type: "number", minimum: 0, maximum: 120, errorMessage: { minimum: "min {min}", maximum: "max {max}" } },
            },
            required: ["age"],
        });
        expect(num).toContain("age: z.number().min(0, 'min 0').max(120, 'max 120'),");

        const int = transformJsonSchemaToZod({
            type: "object",
            properties: { n: { type: "integer" } },
            required: ["n"],
        });
        expect(int).toContain("n: z.number().int(),");
    });

    it("renders enum fields with an optional message", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { color: { type: "string", enum: ["red", "blue"], errorMessage: { type: "pick one" } } },
            required: ["color"],
        });
        expect(code).toContain("z.enum(['red', 'blue'], { message: 'pick one' })");
    });

    it("renders boolean fields and an unknown fallback", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { agree: { type: "boolean" }, weird: { type: "blah" as any } },
            required: ["agree", "weird"],
        });
        expect(code).toContain("agree: z.boolean(),");
        expect(code).toContain("weird: z.unknown(),");
    });

    it("applies a regex pattern", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { code: { type: "string", pattern: "^[A-Z]+$", errorMessage: { pattern: "caps only" } } },
            required: ["code"],
        });
        expect(code).toContain(".regex(/^[A-Z]+$/, 'caps only')");
    });

    it("escapes single quotes and newlines in messages", () => {
        const code = transformJsonSchemaToZod({
            type: "object",
            properties: { x: { type: "string", minLength: 2, errorMessage: { minLength: "it's\nbad" } } },
            required: ["x"],
        });
        expect(code).toContain("it\\'s\\nbad");
    });

    it("handles an empty schema", () => {
        const code = transformJsonSchemaToZod({ type: "object", properties: {}, required: [] });
        expect(code).toContain("export const formSchema = z.object({");
        expect(code).toContain("});");
    });
});
