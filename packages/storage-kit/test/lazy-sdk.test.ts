import { describe, expect, it } from "bun:test";

// In a fresh process: this test file's own imports would pollute require.cache.
async function sdkLoadedAfter(code: string): Promise<boolean> {
    const proc = Bun.spawn([process.execPath, "-e", `${code}
console.log(Object.keys(require.cache).some((k) => k.includes("@aws-sdk/client-s3")));`], {
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "inherit",
    });
    const out = (await new Response(proc.stdout).text()).trim();
    expect(await proc.exited).toBe(0);
    return out === "true";
}

describe("AWS SDK loading", () => {
    it("is not loaded by importing the package", async () => {
        // Regression: the index re-exported S3StorageAdapter, whose module
        // imported the SDK, so every app importing storage-kit (or web-kit)
        // paid for it even with local storage only.
        expect(await sdkLoadedAfter(`await import("../src/index.ts");`)).toBe(false);
    }, 20_000);

    it("is loaded once an S3 adapter is created", async () => {
        expect(
            await sdkLoadedAfter(`const { S3StorageAdapter } = await import("../src/index.ts");
new S3StorageAdapter({ adapter: "s3", connection: { bucket: "b", accessKey: "k", secretKey: "s" } });`),
        ).toBe(true);
    }, 20_000);
});
