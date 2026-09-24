import { describe, expect, it } from "bun:test";
import { AuthFeature } from "../src/features/auth/index";

const secret = "x".repeat(40);
const fakeCreateAuth = (() => ({ handler: async () => new Response("ok"), api: { getSession: async () => null } })) as any;

// better-auth ignores basePath when baseURL has a path, so e.g. a proxy prefix
// in baseURL made every auth route 404 (forms-app's docker-compose did this).
describe("AuthFeature baseURL", () => {
    it("rejects a baseURL whose path differs from basePath", () => {
        expect(() => new AuthFeature({ secret, baseURL: "http://localhost/admin/api", basePath: "/api/auth" }, fakeCreateAuth))
            .toThrow(/baseURL "http:\/\/localhost\/admin\/api" has the path "\/admin\/api".*"http:\/\/localhost"/);
    });

    it("accepts an origin, or a path equal to basePath", () => {
        expect(() => new AuthFeature({ secret, baseURL: "http://localhost:4000", basePath: "/api/auth" }, fakeCreateAuth)).not.toThrow();
        expect(() => new AuthFeature({ secret, baseURL: "https://example.com/" }, fakeCreateAuth)).not.toThrow();
        expect(() => new AuthFeature({ secret, baseURL: "https://example.com/api/sso" }, fakeCreateAuth)).not.toThrow();
    });

    it("rejects an invalid baseURL", () => {
        expect(() => new AuthFeature({ secret, baseURL: "not a url" }, fakeCreateAuth)).toThrow(/invalid baseURL/);
    });
});
