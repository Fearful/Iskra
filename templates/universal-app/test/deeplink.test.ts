import { describe, it, expect } from 'bun:test';
import { parseNoteDeepLink } from '../src/platforms/mobile.ts';

describe('mobile deep links', () => {
    it('accepts miapp://note?title=...', () => {
        expect(parseNoteDeepLink('miapp://note?title=Hola%20mundo')).toEqual({ title: 'Hola mundo' });
        expect(parseNoteDeepLink('miapp://note/?title=Hola')).toEqual({ title: 'Hola' });
    });

    it('ignores links that are anything else', () => {
        // Any URL with ?title= used to create a note (and a malformed one threw).
        for (const link of [
            'https://evil.example/note?title=spam',
            'miapp://evil.example/note?title=spam',
            'miapp://note/delete-all?title=spam',
            'miapp://user:pass@note?title=spam',
            'miapp://note:8080?title=spam',
            'miapp://note',
            'miapp://note?title=%20%20',
            `miapp://note?title=${'x'.repeat(201)}`,
            'not a url',
            42,
        ]) {
            expect(parseNoteDeepLink(link)).toBeNull();
        }
    });
});
