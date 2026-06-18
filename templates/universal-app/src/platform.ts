/**
 * Deteccion de plataforma en tiempo de ejecucion.
 *
 * El mismo codebase corre en escritorio (Tauri), movil (Tauri mobile) y como
 * proceso server (dev / SSR / tests). Cada entorno expone pistas distintas en
 * el global; aca las centralizamos para que el resto del codigo no dependa de
 * detalles del runtime.
 */
export type Platform = 'desktop' | 'mobile' | 'server';

interface TauriGlobals {
    __TAURI__?: unknown;
    __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string };
}

function getTauriGlobals(): TauriGlobals | null {
    if (typeof globalThis === 'undefined') return null;
    const g = globalThis as unknown as { window?: TauriGlobals };
    return g.window ?? null;
}

/** True si corremos dentro de un webview de Tauri (escritorio o movil). */
export function isTauri(): boolean {
    const w = getTauriGlobals();
    return !!w && '__TAURI__' in w;
}

/** True si el host Tauri reporta una plataforma movil (ios / android). */
export function isMobile(): boolean {
    const w = getTauriGlobals();
    const platform = w?.__TAURI_OS_PLUGIN_INTERNALS__?.platform;
    return platform === 'ios' || platform === 'android';
}

/**
 * Resuelve la plataforma actual.
 *
 * - `mobile`  → Tauri + host iOS/Android
 * - `desktop` → Tauri en escritorio
 * - `server`  → cualquier otro runtime (Node/Bun sin webview)
 */
export function detectPlatform(): Platform {
    if (!isTauri()) return 'server';
    return isMobile() ? 'mobile' : 'desktop';
}
