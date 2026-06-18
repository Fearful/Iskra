import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Kernel } from "../src/kernel";
import { CacheFeature } from "../src/features/cache";

// Exercises the Redis cache adapter against a real Redis. Skipped when no Redis
// is reachable so the unit suite (memory adapter) stays infra-free.
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";

async function redisReachable(): Promise<boolean> {
    const url = new URL(REDIS_URL);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        Bun.connect({
            hostname: url.hostname,
            port: Number(url.port) || 6379,
            socket: {
                data() {},
                open(socket) {
                    clearTimeout(timer);
                    socket.end();
                    resolve(true);
                },
                connectError() {
                    clearTimeout(timer);
                    resolve(false);
                },
            },
        }).catch(() => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

const redisUp = await redisReachable();

describe.if(redisUp)("CacheFeature with the Redis adapter (requires Redis)", () => {
    const url = new URL(REDIS_URL);
    const prefix = `cachetest:${Date.now()}:`;
    let kernel: Kernel;
    let cache: CacheFeature;

    beforeAll(async () => {
        kernel = new Kernel();
        cache = new CacheFeature({
            adapter: "redis",
            connection: { host: url.hostname, port: Number(url.port) || 6379 },
        });
        kernel.registerFeature(cache);
        await kernel.initialize();
    });

    afterAll(async () => {
        for (const k of ["str", "obj", "ttl", "ex", "counter"]) {
            await cache.client.delete(prefix + k);
        }
        await kernel.shutdown();
    });

    it("stores and reads back a plain string", async () => {
        await cache.client.set(prefix + "str", "plain");
        expect(await cache.client.get(prefix + "str")).toBe("plain");
    });

    it("round-trips an object through JSON", async () => {
        await cache.client.set(prefix + "obj", { a: 1, b: [2, 3] });
        expect(await cache.client.get(prefix + "obj")).toEqual({ a: 1, b: [2, 3] });
    });

    it("returns null for a missing key", async () => {
        expect(await cache.client.get(prefix + "missing")).toBeNull();
    });

    it("applies a TTL on set", async () => {
        await cache.client.set(prefix + "ttl", "temp", 60);
        expect(await cache.client.get(prefix + "ttl")).toBe("temp");
    });

    it("reports existence and deletes keys", async () => {
        await cache.client.set(prefix + "ex", "1");
        expect(await cache.client.exists(prefix + "ex")).toBe(true);
        await cache.client.delete(prefix + "ex");
        expect(await cache.client.exists(prefix + "ex")).toBe(false);
    });

    it("increments a counter", async () => {
        await cache.client.delete(prefix + "counter");
        expect(await cache.client.increment!(prefix + "counter")).toBe(1);
        expect(await cache.client.increment!(prefix + "counter")).toBe(2);
    });
});
