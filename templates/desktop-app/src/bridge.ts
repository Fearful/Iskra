/**
 * Puente entre el dominio de la App de Iskra y las APIs nativas de Tauri.
 *
 * En una app Tauri real, el frontend (webview) llama a comandos Rust con
 * `invoke()` y escucha eventos con `listen()`. Este modulo concentra esas
 * llamadas detras de una clase, de modo que el resto del codigo de dominio no
 * dependa directamente de `@tauri-apps/api` y sea testeable.
 *
 * Las funciones de `@tauri-apps/api` solo existen cuando el codigo corre dentro
 * del webview de Tauri. Por eso detectamos el entorno y, fuera de Tauri (por
 * ejemplo al correr `bun start` en una terminal), usamos stubs que loguean.
 */

import type { App } from '@iskra-bun/core';

const inTauri = '__TAURI_INTERNALS__' in globalThis;

/** Lo que devuelve el comando Rust `abrir_archivo`. */
export interface ArchivoLeido {
    ruta: string;
    contenido: string;
}

export class DesktopBridge {
    constructor(private readonly app: App) {}

    /** Cambia el titulo de la ventana actual. */
    async setWindowTitle(title: string): Promise<void> {
        if (!inTauri) {
            this.app.logger.info({ title }, '[stub] setWindowTitle');
            return;
        }
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setTitle(title);
    }

    /** Llama a un comando Rust registrado en el backend de Tauri. */
    async invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (!inTauri) {
            this.app.logger.info({ command, args }, '[stub] invoke');
            return undefined as T;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<T>(command, args);
    }

    /**
     * Abre el dialogo nativo y lee el archivo que elige el usuario, todo en
     * Rust (comando `abrir_archivo`). null si cancela. Ningun comando recibe
     * una ruta: el viejo `leer_archivo(ruta)` leia cualquier archivo que le
     * pidiera un script del webview.
     */
    async pickFile(): Promise<ArchivoLeido | null> {
        if (!inTauri) {
            this.app.logger.info('[stub] pickFile → null');
            return null;
        }
        return this.invoke<ArchivoLeido | null>('abrir_archivo');
    }

    /** Reenvia eventos emitidos desde Rust al bus de eventos de Iskra. */
    async forwardTauriEvent(tauriEvent: string, appEvent: string): Promise<void> {
        if (!inTauri) {
            this.app.logger.info({ tauriEvent, appEvent }, '[stub] forwardTauriEvent');
            return;
        }
        const { listen } = await import('@tauri-apps/api/event');
        await listen(tauriEvent, (event) => this.app.emit(appEvent, event.payload));
    }
}
