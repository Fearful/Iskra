import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Rust side is not compiled in CI, so these check the Tauri sources and
// config that decide what the webview may do.
const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const list = (items: string) =>
    items
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
        .sort();

describe('desktop-app IPC surface', () => {
    const lib = read('src-tauri/src/lib.rs');
    const registered = list(lib.match(/generate_handler!\[([^\]]*)\]/)![1]);

    it('declares every app command in build.rs and grants each one in the capability', () => {
        // Without AppManifest::commands, Tauri 2 lets any webview call every app command.
        const declared = read('src-tauri/build.rs').match(/AppManifest::new\(\)\s*\.commands\(&\[([^\]]*)\]\)/);
        expect(declared).not.toBeNull();
        expect(list(declared![1])).toEqual(registered);

        const { permissions } = JSON.parse(read('src-tauri/capabilities/default.json'));
        for (const command of registered) expect(permissions).toContain(`allow-${command.replace(/_/g, '-')}`);
    });

    it('never lets the webview pick the path Rust reads', () => {
        // leer_archivo(ruta) read any file a script in the page asked for (~/.ssh included).
        const signatures = [...lib.matchAll(/#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\(([^)]*)\)/g)];
        expect(signatures.map((m) => m[1]).sort()).toEqual(registered);
        for (const [, name, params] of signatures) {
            expect({ name, params }).toEqual({ name, params: expect.not.stringMatching(/String|str|Path/) });
        }
    });

    it('keeps the global Tauri API and inline styles off', () => {
        const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
        expect(conf.app.withGlobalTauri ?? false).toBe(false);
        expect(conf.app.security.csp).not.toContain("'unsafe-inline'");
        // The UI read window.__TAURI__, which only exists with withGlobalTauri.
        const code = read('ui/app.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        expect(code).toContain('__TAURI_INTERNALS__');
        expect(code).not.toMatch(/__TAURI__[^_A-Z]/);
    });
});
