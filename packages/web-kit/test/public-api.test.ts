import { describe, expect, it } from "bun:test";
// Imports go through the package entry point on purpose: the root typecheck
// then fails if a public class is only reachable as a type.
import { AuthFeature, DbFeature, HealthCheckFeature, Kernel, UploadFeature } from "../src/index";

describe("web-kit public API", () => {
    it("exports Kernel and the features as values", () => {
        const kernel = new Kernel();
        expect(kernel).toBeInstanceOf(Kernel);
        for (const feature of [AuthFeature, DbFeature, HealthCheckFeature, UploadFeature]) {
            expect(typeof feature).toBe("function");
        }
    });
});
