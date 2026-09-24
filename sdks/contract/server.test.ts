import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startContractServer, type ContractServer } from "./server";

// Keeps the SDK contract server booting as web-kit evolves; the SDK suites
// (sdks/python, sdks/java) exercise it in depth.
describe("SDK contract server", () => {
    let server: ContractServer;

    beforeAll(async () => {
        server = await startContractServer();
    });

    afterAll(async () => {
        await server.stop();
    });

    it("serves health, auth and the upload routes", async () => {
        const health = await fetch(`${server.baseUrl}/health`);
        expect(health.status).toBe(200);
        expect(((await health.json()) as { status: string }).status).toBe("ok");

        const signUp = await fetch(`${server.baseUrl}/api/sso/sign-up/email`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "smoke@example.com", password: "password123", name: "Smoke" }),
        });
        expect(signUp.status).toBe(200);
        const cookie = signUp.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .find((c) => c.includes("session_token="));
        expect(cookie).toBeDefined();

        const form = new FormData();
        form.append("file", new File(["hi"], "hello.txt", { type: "text/plain" }));
        expect((await fetch(`${server.baseUrl}/upload`, { method: "POST", body: form })).status).toBe(403);
        const upload = await fetch(`${server.baseUrl}/upload`, { method: "POST", body: form, headers: { cookie: cookie! } });
        expect(upload.status).toBe(200);
        expect(await upload.json()).toMatchObject({ success: true, path: "contract/hello.txt", size: 2 });
    });
});
