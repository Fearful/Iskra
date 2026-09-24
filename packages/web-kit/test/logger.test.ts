import { describe, it, expect, spyOn } from "bun:test";
import { Kernel } from "../src/kernel";
import { LoggerFeature } from "../src/features/logger";
import type { LoggerConfig } from "../src/types";

/** Which of debug/info/warn/error a handler's `c.get("logger")` writes at `level`. */
async function written(level: LoggerConfig["level"]): Promise<string[]> {
    const kernel = new Kernel();
    kernel.registerFeature(new LoggerFeature({ level }));
    await kernel.initialize();
    kernel.getApp().get("/", (c) => {
        const logger = c.get("logger");
        logger.debug("d");
        logger.info("i");
        logger.warn("w");
        logger.error("e");
        return c.text("ok");
    });
    // Only around the request, and always restored: other test files spy on
    // the console too (a leftover spy broke mailer-kit's "silent" test).
    const spies = (["debug", "log", "warn", "error"] as const).map((m) => spyOn(console, m).mockImplementation(() => {}));
    try {
        await kernel.getApp().request("/");
        // Read before mockRestore(), which also clears the recorded calls.
        const [debug, log, warn, error] = spies;
        return [
            ...(debug.mock.calls.some((a) => a[0] === "[DEBUG] d") ? ["debug"] : []),
            ...(log.mock.calls.some((a) => a[0] === "[INFO] i") ? ["info"] : []),
            ...(warn.mock.calls.some((a) => a[0] === "[WARN] w") ? ["warn"] : []),
            ...(error.mock.calls.some((a) => a[0] === "[ERROR] e") ? ["error"] : []),
        ];
    } finally {
        spies.forEach((s) => s.mockRestore());
        await kernel.shutdown();
    }
}

describe("LoggerFeature level", () => {
    it("writes only messages at or above the configured level", async () => {
        // Regression: `level` was ignored and every message was written.
        expect(await written("error")).toEqual(["error"]);
        expect(await written("warning")).toEqual(["warn", "error"]);
        expect(await written("info")).toEqual(["info", "warn", "error"]);
        expect(await written("debug")).toEqual(["debug", "info", "warn", "error"]);
    });

    it("writes everything without a level, as before", async () => {
        expect(await written(undefined)).toEqual(["debug", "info", "warn", "error"]);
    });
});
