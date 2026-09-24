import { describe, it, expect } from "bun:test";
import { App } from "@iskra-bun/core";
import { MobileDriver } from "../src/driver";
import * as pkg from "../src";

// Baseline coverage for the mobile-kit driver. Like desktop-kit it is a thin
// lifecycle shell, so these tests pin the Driver contract: name, interface
// shape, App registration, and a full init/start/stop cycle.

function makeApp() {
    return new App({ name: "MobileTest", logger: { level: "error" } });
}

describe("MobileDriver", () => {
    it("warns on start that it is a placeholder (it used to claim an active bridge)", async () => {
        const app = makeApp();
        const warnings: string[] = [];
        app.logger.warn = ((msg: string) => { warnings.push(msg); }) as any;
        const driver = new MobileDriver();
        await driver.init(app);
        await driver.start();
        expect(warnings.join("\n")).toContain("does not integrate with any mobile platform");
    });

    it("exposes the expected driver name", () => {
        expect(new MobileDriver().name).toBe("MobileDriver");
    });

    it("conforms to the Driver interface (init, start, stop are functions)", () => {
        const driver = new MobileDriver();
        expect(typeof driver.init).toBe("function");
        expect(typeof driver.start).toBe("function");
        expect(typeof driver.stop).toBe("function");
    });

    it("init() resolves with the app", async () => {
        const driver = new MobileDriver();
        await expect(driver.init(makeApp())).resolves.toBeUndefined();
    });

    it("runs through the full App lifecycle (start then stop) without throwing", async () => {
        const app = makeApp();
        const driver = new MobileDriver();
        expect(app.register(driver)).toBe(app);
        await app.start();
        await app.stop();
    });

    it("stop() resolves cleanly when called directly", async () => {
        const driver = new MobileDriver();
        await driver.init(makeApp());
        await expect(driver.stop()).resolves.toBeUndefined();
    });
});

describe("mobile-kit index exports", () => {
    it("re-exports MobileDriver from the package entrypoint", () => {
        expect(pkg.MobileDriver).toBe(MobileDriver);
    });
});
