import { describe, it, expect } from "bun:test";
import { App } from "@iskra-bun/core";
import { DesktopDriver } from "../src/driver";
import * as pkg from "../src";

// Baseline coverage for the desktop-kit Tauri-bridge driver. The driver is a
// thin shell today, so these tests pin its public contract: the Driver
// interface shape, registration into an App, and a clean start lifecycle.

function makeApp() {
    return new App({ name: "DesktopTest", logger: { level: "error" } });
}

describe("DesktopDriver", () => {
    it("exposes the expected driver name", () => {
        expect(new DesktopDriver().name).toBe("DesktopDriver");
    });

    it("conforms to the Driver interface (init + start are functions)", () => {
        const driver = new DesktopDriver();
        expect(typeof driver.init).toBe("function");
        expect(typeof driver.start).toBe("function");
    });

    it("init() resolves and captures the app reference", async () => {
        const driver = new DesktopDriver();
        await expect(driver.init(makeApp())).resolves.toBeUndefined();
    });

    it("registers into an App and runs through start() without throwing", async () => {
        const app = makeApp();
        const driver = new DesktopDriver();
        // register() is chainable and returns the app.
        expect(app.register(driver)).toBe(app);
        await app.start();
        await app.stop();
    });

    it("start() is safe to call directly even without init()", async () => {
        const driver = new DesktopDriver();
        await expect(driver.start()).resolves.toBeUndefined();
    });
});

describe("desktop-kit index exports", () => {
    it("re-exports DesktopDriver from the package entrypoint", () => {
        expect(pkg.DesktopDriver).toBe(DesktopDriver);
    });
});
