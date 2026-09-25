import { describe, expect, it } from 'bun:test';
import { BaseStorageAdapter } from '../src/base';

// Covers: LOW generateFileName uses Math.random() (predictable) (src/base.ts).
// Fix expectation: use crypto.randomUUID() / crypto.getRandomValues so generated
// names are unguessable. We verify by replacing Math.random with a constant and
// confirming the generated names are still unique (i.e. they no longer derive
// their randomness from Math.random()).

class ExposedAdapter extends BaseStorageAdapter {
    async connect() {}
    async disconnect() {}
    async put(): Promise<any> {
        return {};
    }
    async get() {
        return null;
    }
    async getStream() {
        return null;
    }
    async delete() {}
    async exists() {
        return false;
    }
    async list() {
        return [];
    }
    async url() {
        return '';
    }
    async isDirectory() {
        return false;
    }
    public gen(name: string) {
        return this.generateFileName(name);
    }
}

describe('generateFileName uses a cryptographic source', () => {
    it('produces unique names even when Math.random is frozen', () => {
        const adapter = new ExposedAdapter();
        const original = Math.random;
        // Freeze Math.random to a constant. If the implementation relies on
        // Math.random for entropy, names will collide. A crypto-backed
        // implementation stays unique.
        Math.random = () => 0.42;
        try {
            const names = new Set<string>();
            for (let i = 0; i < 200; i++) {
                names.add(adapter.gen('file.txt'));
            }
            expect(names.size).toBe(200);
        } finally {
            Math.random = original;
        }
    });

    it('preserves the original file extension', () => {
        const adapter = new ExposedAdapter();
        expect(adapter.gen('photo.png').endsWith('.png')).toBe(true);
    });
});
