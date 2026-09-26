import { Kernel } from '../src/kernel';
import { DbFeature } from '../src/features/db';
import { CacheFeature } from '../src/features/cache';
import { StorageFeature } from '../src/features/storage';
import { OpenAPIFeature } from '../src/features/openapi';

/**
 * Example 1: Auto-generate from all features
 */
async function example1_AutoGenerateAll() {
    console.log('=== Example 1: Auto-Generate from All Features ===\n');

    const kernel = new Kernel({ port: 8000 });

    // Register all features BEFORE OpenAPI
    kernel.registerFeature(new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } })); // Memory SQLite
    kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
    kernel.registerFeature(
        new StorageFeature({
            adapter: 'local',
            // basePath: "./storage", // Not in StorageConfig type yet? Default to current dir or ./storage if implemented
        }),
    );

    // OpenAPI will auto-detect and generate routes for all features
    const openapi = new OpenAPIFeature({
        title: 'Complete Platform API',
        version: '1.0.0',
        description: 'API with auto-generated feature routes',
    });

    kernel.registerFeature(openapi);
    await kernel.initialize();

    // Mount OpenAPI app
    openapi.routes(kernel.getApp());

    console.log('✅ Auto-generated routes for:');
    console.log('   - Database, Cache, Storage');
    console.log('\n📚 Documentation:');
    console.log('   - Scalar UI: http://localhost:8000/docs');
    console.log('   - OpenAPI JSON: http://localhost:8000/openapi.json');
    console.log('   - Routes List: http://localhost:8000/openapi/routes');

    // await kernel.shutdown();
    // Keep running for manual check if needed, or shutdown if just test.
    // For examples, usually we bind port and let user kill it.
    // But here we have multiple functions.
    // In `if (import.meta.main)` we can run one.
    return kernel;
}

if (import.meta.main) {
    await example1_AutoGenerateAll();
    // Starting the returned kernel (`await kernel.start()`) would block.
    // For now, just initialization demonstration.
    console.log('Server initialized. Access docs at http://localhost:8000/docs (if started)');
}
