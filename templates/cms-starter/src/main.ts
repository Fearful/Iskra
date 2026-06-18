import { App } from '@iskra-bun/core';
import { WebPlugin } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { config } from './app.config.ts';
import { ContentService } from './domain/content/content.service.ts';
import { createContentRouter } from './interfaces/http/router.ts';

const app = new App({
    name: 'CMSStarter',
    db: {
        driver: 'sqlite',
        url: config.db.url,
    },
});

const db = new DbDriver();
const contentService = new ContentService(db);

// El DbDriver debe iniciar antes que el WebPlugin para que el servicio tenga conexion.
app.register(db);
app.register(
    new WebPlugin({
        port: config.web.port,
        router: createContentRouter(contentService),
    }),
);

async function main() {
    await app.start();
    await contentService.initTables();
    app.logger.info({ port: config.web.port, db: config.db.url }, 'CMS Starter escuchando');
}

main().catch((err) => {
    console.error('No se pudo arrancar CMS Starter:', err);
    process.exit(1);
});
