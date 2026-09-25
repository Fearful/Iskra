import { describe, expect, it, spyOn } from 'bun:test';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseCreateAdminArgs, readAdminPassword } from '../src/scripts/create-admin.ts';

const SCRIPT = join(import.meta.dir, '..', 'src', 'scripts', 'create-admin.ts');

/** stdin as a pipe (not a terminal) carrying `text`. */
const piped = (text: string) => Readable.from([text]) as unknown as NodeJS.ReadStream;

/** stdin as a terminal on which each of `lines` is typed once the previous prompt is answered. */
function terminal(lines: string[]) {
    const tty = Object.assign(new EventEmitter(), {
        isTTY: true,
        raw: false,
        setRawMode: (raw: boolean) => void (tty.raw = raw),
        setEncoding: () => {},
        resume: () => void queueMicrotask(() => tty.emit('data', lines.shift())),
        pause: () => {},
    });
    return tty;
}

/** The DEL a terminal sends for Backspace, and Ctrl-C, in raw mode. */
const BACKSPACE = String.fromCharCode(127);
const CTRL_C = String.fromCharCode(3);

describe('create-admin', () => {
    it('refuses the password as a command-line argument', () => {
        // Arguments are visible to every user in `ps` and stay in the shell history.
        expect(() => parseCreateAdminArgs(['admin@example.com', 'correct-horse-battery-staple'])).toThrow(
            'the password is not taken as an argument',
        );
        expect(() => parseCreateAdminArgs(['admin@example.com', 'pw', 'Admin'])).toThrow(
            'the password is not taken as an argument',
        );
        expect(() => parseCreateAdminArgs([])).toThrow('usage: bun run create-admin');
    });

    it('takes the email and an optional --name', () => {
        expect(parseCreateAdminArgs(['admin@example.com'])).toEqual({ email: 'admin@example.com', name: undefined });
        expect(parseCreateAdminArgs(['admin@example.com', '--name', 'Ada Lovelace'])).toEqual({
            email: 'admin@example.com',
            name: 'Ada Lovelace',
        });
    });

    it('reads the password from ADMIN_PASSWORD, or else from the first line of stdin', async () => {
        expect(await readAdminPassword({ ADMIN_PASSWORD: 'from-the-env' }, piped('ignored\n'))).toBe('from-the-env');
        expect(await readAdminPassword({}, piped('from stdin\nsecond line\n'))).toBe('from stdin');
        expect(await readAdminPassword({}, piped('no newline'))).toBe('no newline');
    });

    it('asks twice at a terminal, without echo', async () => {
        const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const tty = terminal([`hunter${BACKSPACE}r2-long\r`, 'hunter2-long\r']);
            expect(await readAdminPassword({}, tty as unknown as NodeJS.ReadStream)).toBe('hunter2-long');
            expect(tty.raw).toBe(false);
            expect(stderr.mock.calls.join('')).not.toContain('hunter');

            const mismatch = terminal(['one-password\r', 'another-one\r']);
            await expect(readAdminPassword({}, mismatch as unknown as NodeJS.ReadStream)).rejects.toThrow(
                'the passwords do not match',
            );
            const cancelled = terminal([`abc${CTRL_C}`]);
            await expect(readAdminPassword({}, cancelled as unknown as NodeJS.ReadStream)).rejects.toThrow('cancelled');
            expect(cancelled.raw).toBe(false);
        } finally {
            stderr.mockRestore();
        }
    });

    it('exits with the usage, before connecting anywhere, when given a password', () => {
        const proc = Bun.spawnSync([process.execPath, SCRIPT, 'admin@example.com', 'hunter2-hunter2'], {
            env: { ...process.env, DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none' },
            stdin: 'ignore',
        });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('the password is not taken as an argument');
    });
});
