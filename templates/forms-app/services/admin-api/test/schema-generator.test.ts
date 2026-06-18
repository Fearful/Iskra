import { describe, it, expect } from "bun:test";
import { generateJsonSchema } from "../src/domain/forms/schema-generator";

describe("generateJsonSchema", () => {
    it("builds a string property with maxLength and default messages for a text field", () => {
        const schema = generateJsonSchema([
            { fieldType: "text", name: "title", label: "Title", required: true, maxLength: 100 },
        ]);
        expect(schema.properties.title).toMatchObject({ type: "string", maxLength: 100 });
        expect(schema.required).toContain("title");
        expect(schema.properties.title.errorMessage.required).toBe("This field is required");
        expect(schema.properties.title.errorMessage.maxLength).toBe("Maximum 100 characters allowed");
    });

    it("builds an email property with format and a default format message", () => {
        const schema = generateJsonSchema([
            { fieldType: "email", name: "e", label: "Email", required: true },
        ]);
        expect(schema.properties.e).toMatchObject({ type: "string", format: "email" });
        expect(schema.properties.e.errorMessage.format).toBe("Please enter a valid email address");
    });

    it("builds a number property with minimum/maximum and interpolated messages", () => {
        const schema = generateJsonSchema([
            { fieldType: "number", name: "age", label: "Age", required: false, min: 18, max: 99 },
        ]);
        expect(schema.properties.age).toMatchObject({ type: "number", minimum: 18, maximum: 99 });
        expect(schema.properties.age.errorMessage.minimum).toBe("Value must be at least 18");
        expect(schema.properties.age.errorMessage.maximum).toBe("Value must be at most 99");
        expect(schema.required).not.toContain("age");
    });

    it("builds an enum from options for select/radio fields", () => {
        const schema = generateJsonSchema([
            {
                fieldType: "select",
                name: "color",
                label: "Color",
                required: true,
                options: [
                    { label: "Red", value: "red" },
                    { label: "Blue", value: "blue" },
                ],
            },
        ]);
        expect(schema.properties.color.type).toBe("string");
        expect(schema.properties.color.enum).toEqual(["red", "blue"]);
    });

    it("builds a boolean for a single checkbox and a string for a multi checkbox", () => {
        const single = generateJsonSchema([
            { fieldType: "checkbox", name: "agree", label: "Agree", required: true },
        ]);
        expect(single.properties.agree.type).toBe("boolean");

        const multi = generateJsonSchema([
            {
                fieldType: "checkbox",
                name: "opts",
                label: "Options",
                required: false,
                options: [{ label: "A", value: "a" }],
            },
        ]);
        expect(multi.properties.opts.type).toBe("string");
    });

    it("builds a date property with format", () => {
        const schema = generateJsonSchema([
            { fieldType: "date", name: "d", label: "D", required: false },
        ]);
        expect(schema.properties.d).toMatchObject({ type: "string", format: "date" });
    });

    it("applies a per-field custom message across rules", () => {
        const schema = generateJsonSchema([
            { fieldType: "text", name: "t", label: "T", required: true, errorMessage: "Please fill this in" },
        ]);
        expect(schema.properties.t.errorMessage.required).toBe("Please fill this in");
        expect(schema.properties.t.errorMessage.type).toBe("Please fill this in");
    });
});
