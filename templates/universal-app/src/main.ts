import { App } from '@iskra-bun/core';
import { config } from './app.config.ts';
import './events.ts';
import { detectPlatform, type Platform } from './platform.ts';
import { bootstrapDesktop } from './platforms/desktop.ts';
import { bootstrapMobile } from './platforms/mobile.ts';

const app = new App({ name: config.app.name });

/**
 * Resuelve la plataforma: respeta FORCE_PLATFORM si esta seteado, si no la
 * detecta en runtime. Cuando corremos como proceso server (sin webview Tauri),
 * usamos 'desktop' como rama por defecto para que el ejemplo arranque.
 */
function resolvePlatform(): Platform {
    if (config.forcePlatform !== 'auto') return config.forcePlatform;
    const detected = detectPlatform();
    return detected === 'server' ? 'desktop' : detected;
}

async function main() {
    const platform = resolvePlatform();
    app.logger.info({ platform }, 'Arrancando Universal App');

    // Solo se registra el driver de la plataforma activa: un codebase, una rama.
    if (platform === 'mobile') {
        bootstrapMobile(app);
    } else {
        bootstrapDesktop(app);
    }

    await app.start();
    app.logger.info({ platform }, 'Universal App lista');

    // Demo: emitir un evento de la plataforma activa para ver la logica compartida.
    if (platform === 'mobile') {
        app.emit('mobile:deeplink', { url: 'miapp://note?title=Hola%20desde%20deep%20link' });
    } else {
        app.emit('desktop:new-note', { title: 'Mi primera nota', body: 'Creada en escritorio' });
    }
}

main().catch((err) => {
    app.logger.error({ err }, 'Fallo al arrancar Universal App');
    process.exit(1);
});
