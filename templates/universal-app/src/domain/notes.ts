import { z } from 'zod';

/**
 * Logica de negocio compartida entre escritorio y movil.
 *
 * No conoce la plataforma ni la UI: opera sobre datos puros. Cada plataforma
 * decide como mostrar / persistir estas notas. El store es inmutable: cada
 * operacion devuelve un nuevo array en vez de mutar el anterior.
 */
/** Topes de una nota: la crean eventos externos (deep links, menus). */
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 10_000;

export const NoteSchema = z.object({
    id: z.string(),
    title: z.string().min(1, 'El titulo no puede estar vacio').max(NOTE_TITLE_MAX),
    body: z.string().max(NOTE_BODY_MAX).default(''),
    createdAt: z.string(),
});

export type Note = z.infer<typeof NoteSchema>;

export const CreateNoteSchema = NoteSchema.pick({ title: true, body: true }).partial({ body: true });
export type CreateNote = z.infer<typeof CreateNoteSchema>;

/** Crea una nota validando el input. Lanza ZodError si el titulo es invalido. */
export function createNote(input: CreateNote): Note {
    const parsed = CreateNoteSchema.parse(input);
    return NoteSchema.parse({
        id: crypto.randomUUID(),
        title: parsed.title,
        body: parsed.body ?? '',
        createdAt: new Date().toISOString(),
    });
}

/** Devuelve un nuevo array con la nota agregada (sin mutar el original). */
export function addNote(notes: readonly Note[], note: Note): Note[] {
    return [...notes, note];
}

/** Devuelve un nuevo array sin la nota indicada. */
export function removeNote(notes: readonly Note[], id: string): Note[] {
    return notes.filter((n) => n.id !== id);
}

/** Resumen apto para loguear o renderizar en cualquier plataforma. */
export function summarize(notes: readonly Note[]): { count: number; titles: string[] } {
    return {
        count: notes.length,
        titles: notes.map((n) => n.title),
    };
}
