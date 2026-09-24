import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe('ProcessManager – forced exit of the parent', () => {
    it.skipIf(process.platform === 'win32')(
        'kills the children when the app exits before stop() finishes with them',
        async () => {
            // Regression: children run in their own process group, so when the
            // App's shutdownTimeoutMs forced process.exit(1) mid-stop, a child
            // ignoring SIGTERM was left running with init as its parent.
            const fixture = join(import.meta.dir, 'fixtures', 'forced-exit-app.ts');
            const proc = Bun.spawn([process.execPath, fixture], {
                env: { ...process.env, NODE_ENV: 'production' },
                stdout: 'pipe',
                stderr: 'ignore',
            });
            const reader = proc.stdout.getReader();
            let out = '';
            // Both the child's pid and the App's "ready" (signal handlers
            // installed): a SIGTERM before that takes the default action.
            while (!/child pid=\d+\n/.test(out) || !out.includes('ready\n')) {
                const { value, done } = await reader.read();
                if (done) break;
                out += new TextDecoder().decode(value);
            }
            const childPid = Number(out.match(/child pid=(\d+)\n/)?.[1]);
            try {
                expect(childPid).toBeGreaterThan(0);
                expect(alive(childPid)).toBe(true);

                proc.kill('SIGTERM');
                expect(await proc.exited).toBe(1); // forced: shutdownTimeoutMs elapsed

                const deadline = Date.now() + 2000;
                while (alive(childPid) && Date.now() < deadline) await Bun.sleep(25);
                expect(alive(childPid)).toBe(false);
            } finally {
                proc.kill('SIGKILL');
                // Never leak the stubborn child from the test, whatever failed.
                if (childPid > 0 && alive(childPid)) process.kill(-childPid, 'SIGKILL');
            }
        },
        20_000,
    );
});
