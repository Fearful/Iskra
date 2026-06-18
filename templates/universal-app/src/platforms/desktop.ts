import type { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { createNote, addNote, summarize, type Note } from '../domain/notes.ts';

/**
 * Rama de escritorio.
 *
 * Registra el `DesktopDriver` (bridge Tauri de escritorio) y conecta la logica
 * compartida de notas a eventos propios del escritorio (menus, ventanas, etc.).
 */
export function bootstrapDesktop(app: App): void {
    app.register(new DesktopDriver());

    let notes: Note[] = [];

    // En una app real, este evento lo emitiria un comando de menu de Tauri.
    app.on('desktop:new-note', (ctx) => {
        const note = createNote(ctx.payload);
        notes = addNote(notes, note);
        app.logger.info({ platform: 'desktop', ...summarize(notes) }, 'Nota creada (escritorio)');
    });

    app.logger.info('Plataforma: escritorio (Tauri)');
}
