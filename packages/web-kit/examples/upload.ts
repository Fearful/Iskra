import { Kernel } from "../src/kernel";
import { StorageFeature } from "../src/features/storage";
import { UploadFeature } from "../src/features/upload";

/**
 * Example 4: Upload with Built-in Routes
 */
async function example4_BuiltInRoutes() {
    console.log("\n=== Example 4: Upload with Built-in Routes ===\n");

    const kernel = new Kernel({ port: 8203 });

    kernel.registerFeature(
        new StorageFeature({
            adapter: "local",
            // basePath: "./public", 
        }),
    );

    // Enable built-in HTTP routes
    kernel.registerFeature(
        new UploadFeature({
            projectName: "media",
            exposeRoutes: true, // Enable built-in routes
            // Required with exposeRoutes. With AuthFeature, e.g. only signed-in users:
            // authorize: (c) => Boolean(c.get("user")),
            authorize: () => true, // public on purpose (demo)
            // routePrefix: "/media", // Custom prefix
            // maxFileSize: 10 * 1024 * 1024, // 10MB
            // allowedExtensions: [".jpg", ".png", ".gif", ".mp4"],
        }),
    );

    await kernel.initialize();

    console.log("✅ Built-in routes available:");
    console.log("   POST /upload?subfolder=... - Upload file");
    console.log("   GET /upload/list?subfolder=... - List files");
    // console.log("   GET /media/url/:filename - Get file URL");
    // console.log("   DELETE /media/:filename - Delete file");

    await kernel.start();
}

if (import.meta.main) {
    await example4_BuiltInRoutes();
}
