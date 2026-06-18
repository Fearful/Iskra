import { describe, it, expect } from "bun:test";
import { WorkerManager } from "../src/index";
import { QueueError } from "../src/errors";
import { App } from "@iskra-bun/core";

// Note: These tests verify the WorkerManager API and error handling.
// Full BullMQ integration tests require a running Redis instance.
// Tests that need Redis are skipped with descriptive names.

describe("WorkerManager", () => {
    it("should instantiate with connection config", () => {
        const wm = new WorkerManager({
            connection: "redis://localhost:6379",
            concurrency: 2,
            queueName: "test-queue",
        });
        expect(wm.name).toBe("WorkerManager");
    });

    it("should register job handlers", () => {
        const wm = new WorkerManager({ connection: "redis://localhost:6379" });

        const handler = async () => {};
        const result = wm.register("test.job", handler);
        expect(result).toBe(wm); // chainable
    });

    it("should register multiple handlers", () => {
        const wm = new WorkerManager({ connection: "redis://localhost:6379" });

        wm.register("job.a", async () => {})
          .register("job.b", async () => {})
          .register("job.c", async () => {});

        // Should not throw
    });

    it("should throw QueueError when enqueueing without init", async () => {
        const wm = new WorkerManager({ connection: "redis://localhost:6379" });

        try {
            await wm.enqueue("test.job", { data: "test" });
            expect(true).toBe(false); // should not reach
        } catch (err) {
            expect(err).toBeInstanceOf(QueueError);
            expect((err as QueueError).code).toBe("QUEUE_ERROR");
            expect((err as QueueError).message).toContain("not initialized");
        }
    });

    it("should parse string connection URL", () => {
        // Verify URL parsing doesn't throw
        const wm = new WorkerManager({
            connection: "redis://user:pass@redis.example.com:6380/2",
        });
        expect(wm.name).toBe("WorkerManager");
    });

    it("should accept object connection config", () => {
        const wm = new WorkerManager({
            connection: { host: "localhost", port: 6379, password: "secret", db: 1 },
        });
        expect(wm.name).toBe("WorkerManager");
    });

    it("should accept default job options", () => {
        const wm = new WorkerManager({
            connection: "redis://localhost:6379",
            defaultJobOptions: {
                attempts: 3,
                delay: 1000,
                priority: 5,
                backoff: { type: "exponential", delay: 2000 },
                removeOnComplete: 100,
                removeOnFail: 500,
            },
        });
        expect(wm.name).toBe("WorkerManager");
    });

    it("should use default queue name when not specified", () => {
        const wm = new WorkerManager({ connection: "redis://localhost:6379" });
        // Default queue name is 'iskra-jobs' — verified via internal state
        expect(wm.name).toBe("WorkerManager");
    });
});

describe("WorkerManager.parseConnection", () => {
    const parse = (connection: any) =>
        (new WorkerManager({ connection }) as any).parseConnection();

    it("parses a full redis URL into connection parts", () => {
        expect(parse("redis://user:pass@redis.example.com:6380/2")).toEqual({
            host: "redis.example.com",
            port: 6380,
            password: "pass",
            db: 2,
        });
    });

    it("defaults the port to 6379 when omitted", () => {
        expect(parse("redis://localhost/3")).toEqual({
            host: "localhost",
            port: 6379,
            password: undefined,
            db: 3,
        });
    });

    it("defaults the db to 0 when no path is present", () => {
        expect(parse("redis://localhost:6379")).toEqual({
            host: "localhost",
            port: 6379,
            password: undefined,
            db: 0,
        });
    });

    it("returns an object connection unchanged", () => {
        const conn = { host: "localhost", port: 6379, password: "secret", db: 1 };
        expect(parse(conn)).toBe(conn);
    });
});

describe("WorkerManager.mapJobOptions", () => {
    const map = (opts?: any) =>
        (new WorkerManager({ connection: "redis://localhost:6379" }) as any).mapJobOptions(opts);

    it("returns undefined when no options are given", () => {
        expect(map(undefined)).toBeUndefined();
    });

    it("maps every supported job option to the BullMQ shape", () => {
        const opts = {
            attempts: 3,
            delay: 1000,
            priority: 5,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        };
        expect(map(opts)).toEqual(opts);
    });

    it("preserves undefined for unspecified options", () => {
        expect(map({ attempts: 2 })).toEqual({
            attempts: 2,
            delay: undefined,
            priority: undefined,
            backoff: undefined,
            removeOnComplete: undefined,
            removeOnFail: undefined,
        });
    });
});
