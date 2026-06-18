import type { Feature, HealthCheckConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context } from "hono";

export class HealthCheckFeature implements Feature {
    name = "health";

    private kernel?: Kernel;
    private config: Required<Omit<HealthCheckConfig, "checks">> & { checks?: HealthCheckConfig["checks"] };

    constructor(config: HealthCheckConfig = {}) {
        this.config = {
            path: config.path || "/health",
            readinessPath: config.readinessPath || "/health/ready",
            livenessPath: config.livenessPath || "/health/live",
            includeDetails: config.includeDetails !== undefined ? config.includeDetails : true,
            checks: config.checks,
        };
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.kernel = kernel;
        const app = kernel.getApp();

        app.get(this.config.path, async (c: Context) => await this.handleHealthCheck(c));
        app.get(this.config.readinessPath, async (c: Context) => await this.handleReadinessCheck(c));
        app.get(this.config.livenessPath, async (c: Context) => await this.handleLivenessCheck(c));

        console.log("✅ Health check feature initialized");
    }

    private async handleHealthCheck(c: Context) {
        const response: any = {
            status: "ok",
            timestamp: new Date().toISOString(),
        };

        if (this.config.includeDetails && this.kernel) {
            // @ts-expect-error - features is a private kernel field accessed for diagnostics
            response.features = Array.from(this.kernel.features.keys());
            const featureHealth: any = {};

            const dbFeature = this.kernel.getFeature("db");
            if (dbFeature) await this.checkFeatureHealth(c, dbFeature, featureHealth, "db", "query", "SELECT 1");

            const cacheFeature = this.kernel.getFeature("cache");
            if (cacheFeature) await this.checkFeatureHealth(c, cacheFeature, featureHealth, "cache", "exists", "__health_check__");

            if (Object.keys(featureHealth).length > 0) {
                response.checks = featureHealth;
            }

            if (this.config.checks) {
                const customChecks: any = {};
                for (const [name, check] of Object.entries(this.config.checks)) {
                    try {
                        customChecks[name] = await check(c);
                    } catch (error) {
                        customChecks[name] = { status: "error", error: String(error) };
                    }
                }
                response.customChecks = customChecks;
            }
        }

        return c.json(response);
    }

    private async checkFeatureHealth(c: Context, feature: any, report: any, key: string, method: string, ...args: any[]) {
        try {
            // Abstracted check logic
            const instance = c.get(key as any);
            if (instance && typeof instance[method] === "function") {
                await instance[method](...args);
                report[key] = { status: "ok" };
            }
        } catch (e) {
            report[key] = { status: "error", error: String(e) };
        }
    }

    private async handleReadinessCheck(c: Context) {
        // Simplified readiness check
        return c.json({ status: "ready" });
    }

    private async handleLivenessCheck(c: Context) {
        return c.json({
            status: "alive",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    }
}
