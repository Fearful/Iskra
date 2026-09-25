import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { config } from './app.config.ts';
import { DesktopBridge } from './bridge.ts';
import { setupMenu } from './menu.ts';

const app = new App({ name: config.app.name });

app.register(new DesktopDriver());

const bridge = new DesktopBridge(app);
// Disponible para cualquier handler via DI.
app.context.set('bridge', bridge);

/**
 * Handlers de dominio. Reaccionan a eventos emitidos por el menu nativo o por la
 * UI (via comandos Rust reenviados por el bridge). Toda la logica vive acá, no en
 * la capa de UI.
 */
function registerHandlers() {
    app.on('menu:abrir-archivo', async (ctx) => {
        // El dialogo y la lectura corren en Rust (comando `abrir_archivo`).
        const archivo = await bridge.pickFile();
        if (!archivo) {
            ctx.logger.info('El usuario canceló la selección de archivo');
            return;
        }
        ctx.logger.info({ ruta: archivo.ruta }, 'Archivo seleccionado');
        app.emit('archivo:cargado', archivo);
    });

    app.on('menu:acerca-de', async (ctx) => {
        ctx.logger.info({ version: config.app.version }, `Acerca de ${config.app.name}`);
        await bridge.setWindowTitle(`${config.app.name} — Acerca de`);
    });

    app.on('archivo:cargado', (ctx) => {
        const { ruta, contenido } = ctx.payload as { ruta: string; contenido: string };
        ctx.logger.info({ ruta, bytes: contenido?.length ?? 0 }, 'Contenido del archivo listo para la UI');
    });

    // Eventos emitidos desde el backend Rust → bus de Iskra.
    app.on('window:focus', (ctx) => {
        ctx.logger.debug({ focused: ctx.payload }, 'Cambio de foco de la ventana');
    });
}

async function main() {
    registerHandlers();
    await app.start();

    // Ventana: titulo inicial. (Sin Tauri, el bridge loguea un stub.)
    await bridge.setWindowTitle(config.app.name);

    // Menu nativo con acciones cableadas al bus de eventos.
    await setupMenu(app);

    // Reenviar eventos nativos relevantes al bus de la App.
    await bridge.forwardTauriEvent('tauri://focus', 'window:focus');

    app.logger.info(`${config.app.name} iniciada`);
}

main().catch((err) => {
    console.error('Fallo al arrancar la app de escritorio:', err);
    process.exit(1);
});
