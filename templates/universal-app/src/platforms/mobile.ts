import type { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';
import { createNote, addNote, summarize, type Note } from '../domain/notes.ts';

/**
 * Rama movil.
 *
 * Registra el `MobileDriver` y conecta la logica compartida de notas a eventos
 * propios del movil (deep links, push notifications). Ver https://iskra-docs.fly.dev/es/packages/mobile-kit/
 */
export function bootstrapMobile(app: App): void {
    app.register(new MobileDriver());

    let notes: Note[] = [];

    // Crear una nota desde un deep link, ej: miapp://note?title=Hola
    app.on('mobile:deeplink', (ctx) => {
        const url = new URL(ctx.payload.url);
        const title = url.searchParams.get('title');
        if (!title) return;

        const note = createNote({ title });
        notes = addNote(notes, note);
        app.logger.info({ platform: 'mobile', ...summarize(notes) }, 'Nota creada (movil)');
    });

    app.logger.info('Plataforma: movil (Tauri mobile)');
}
