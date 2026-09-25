import type { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';
import { createNote, addNote, summarize, NOTE_TITLE_MAX, type CreateNote, type Note } from '../domain/notes.ts';

/** El esquema de los deep links de la app (registralo en la config de Tauri mobile). */
export const DEEP_LINK_SCHEME = 'miapp:';

/**
 * La nota que pide un deep link `miapp://note?title=...`, o null si el link no
 * es exactamente eso. Cualquier app o pagina web puede abrir un deep link, asi
 * que no se acepta otro esquema, host, ruta, credenciales ni puerto, y el
 * titulo tiene que ser valido; antes, cualquier URL con `?title=` creaba notas.
 */
export function parseNoteDeepLink(link: unknown): CreateNote | null {
    if (typeof link !== 'string' || link.length > 2048) return null;
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (url.protocol !== DEEP_LINK_SCHEME || url.hostname !== 'note') return null;
    if (url.username || url.password || url.port || (url.pathname !== '' && url.pathname !== '/')) return null;

    const title = url.searchParams.get('title')?.trim();
    if (!title || title.length > NOTE_TITLE_MAX) return null;
    return { title };
}

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
        const input = parseNoteDeepLink(ctx.payload.url);
        if (!input) {
            app.logger.warn('Deep link ignorado: no es miapp://note?title=...');
            return;
        }

        const note = createNote(input);
        notes = addNote(notes, note);
        app.logger.info({ platform: 'mobile', ...summarize(notes) }, 'Nota creada (movil)');
    });

    app.logger.info('Plataforma: movil (Tauri mobile)');
}
