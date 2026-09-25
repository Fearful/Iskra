import type { CreateNote } from './domain/notes.ts';

// This app's own events, so their handlers and emit() calls are typed.
declare module '@iskra-bun/core' {
    interface AppEvents {
        /** From a desktop menu command (in a real app, a Tauri menu). */
        'desktop:new-note': CreateNote;
        /** A deep link that opened the mobile app, e.g. miapp://note?title=Hola */
        'mobile:deeplink': { url: string };
    }
}
