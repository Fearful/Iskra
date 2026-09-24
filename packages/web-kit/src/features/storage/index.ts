import type { Feature } from "../../types";
import type { Kernel } from "../../kernel";
import type { StorageConfig } from "@iskra-bun/storage-kit";
import { BaseStorageAdapter, createStorageAdapter } from "@iskra-bun/storage-kit";
import type { Context, Next } from "hono";

export { BaseStorageAdapter, LocalStorageAdapter } from "@iskra-bun/storage-kit";
export type { StorageConfig, StorageFile } from "@iskra-bun/storage-kit";

declare module "hono" {
    interface ContextVariableMap {
        storage: BaseStorageAdapter;
    }
}

export class StorageFeature implements Feature {
    name = "storage";
    private adapter?: BaseStorageAdapter;

    constructor(private config: StorageConfig) { }

    async initialize(kernel: Kernel): Promise<void> {
        this.adapter = await createStorageAdapter(this.config);
        await this.adapter.connect();

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            c.set("storage", this.adapter!);
            await next();
        });

        console.log(`✅ StorageFeature initialized - ${this.config.adapter}`);
    }

    async shutdown(): Promise<void> {
        if (this.adapter) {
            await this.adapter.disconnect();
        }
    }

    getAdapter(): BaseStorageAdapter | undefined {
        return this.adapter;
    }
}
