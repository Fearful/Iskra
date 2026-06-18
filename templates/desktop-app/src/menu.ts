/**
 * Construccion del menu nativo de la aplicacion.
 *
 * Cada item del menu, al activarse, emite un evento en el bus de la App de
 * Iskra. Asi los handlers de menu viven junto al resto de la logica de dominio
 * (ver `registerMenuHandlers` en main.ts) en vez de mezclarse con la UI.
 */

import type { App } from '@iskra-bun/core';

const inTauri = typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';

export async function setupMenu(app: App): Promise<void> {
    if (!inTauri) {
        app.logger.info('[stub] setupMenu (fuera de Tauri no hay menu nativo)');
        return;
    }

    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');

    const abrir = await MenuItem.new({
        id: 'abrir',
        text: 'Abrir archivo…',
        accelerator: 'CmdOrCtrl+O',
        action: () => app.emit('menu:abrir-archivo', {}),
    });

    const acercaDe = await MenuItem.new({
        id: 'acerca-de',
        text: 'Acerca de Iskra Desktop',
        action: () => app.emit('menu:acerca-de', {}),
    });

    const salir = await PredefinedMenuItem.new({ item: 'Quit', text: 'Salir' });

    const archivo = await Submenu.new({
        text: 'Archivo',
        items: [abrir, salir],
    });

    const ayuda = await Submenu.new({
        text: 'Ayuda',
        items: [acercaDe],
    });

    const menu = await Menu.new({ items: [archivo, ayuda] });
    await menu.setAsAppMenu();
}
