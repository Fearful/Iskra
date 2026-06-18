// Test double for bridge/runner.js — speaks the same JSON-over-stdio protocol
// (newline-delimited) but needs no Oracle / oracledb. Behavior is driven by the
// SQL string so tests can exercise success, error, fatal and malformed paths.
const readline = require('readline');

process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
    if (!line.trim()) return;

    let id = null;
    try {
        const req = JSON.parse(line);
        id = req.id;
        const sql = String(req.sql || '');

        if (sql === 'FATAL_TEST') {
            // Fatal messages carry no id; the driver should log and keep going.
            process.stdout.write(JSON.stringify({ type: 'fatal', error: 'simulated fatal' }) + '\n');
            return;
        }

        if (sql === 'BAD_JSON_TEST') {
            // A malformed line must not crash the driver's reader.
            process.stdout.write('this is not valid json\n');
            process.stdout.write(JSON.stringify({ id, data: [{ recovered: true }] }) + '\n');
            return;
        }

        if (sql.includes('FAIL')) {
            process.stdout.write(JSON.stringify({ id, error: 'simulated query failure' }) + '\n');
            return;
        }

        process.stdout.write(JSON.stringify({ id, data: [{ echo: sql, params: req.params }] }) + '\n');
    } catch (err) {
        process.stdout.write(JSON.stringify({ id, error: err.message }) + '\n');
    }
});
