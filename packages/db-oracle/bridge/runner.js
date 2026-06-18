const oracledb = require('oracledb');
const readline = require('readline');

let connection;

async function run() {
    try {
        // 1. Connect to Oracle natively in Node
        connection = await oracledb.getConnection({
            user: process.env.ORA_USER,
            password: process.env.ORA_PASSWORD,
            connectString: process.env.ORA_CONN
        });

        // Send ready signal
        console.log(JSON.stringify({ type: 'ready' }));

        // 2. Listen to STDIN (JSON Lines)
        const rl = readline.createInterface({ input: process.stdin });

        rl.on('line', async (line) => {
            if (!line.trim()) return;

            try {
                const { id, sql, params } = JSON.parse(line);

                // Execute query
                const result = await connection.execute(sql, params || [], {
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: true // Default to autoCommit for simpler usage, can be configurable
                });

                // Respond to Bun
                console.log(JSON.stringify({ id, data: result.rows }));
            } catch (err) {
                // We need to parse valid JSON so we can reply with error for specific ID if possible, 
                // but if parsing fails we might not have ID.
                // For simplicity assuming line parseable or we log generic error.

                let reqId = null;
                try {
                    const parsed = JSON.parse(line);
                    reqId = parsed.id;
                } catch (e) { }

                console.log(JSON.stringify({ id: reqId, error: err.message }));
            }
        });

        rl.on('close', async () => {
            if (connection) {
                try {
                    await connection.close();
                } catch (err) {
                    console.error(err);
                }
            }
            process.exit(0);
        });

    } catch (err) {
        console.log(JSON.stringify({ error: err.message, type: 'fatal' }));
        process.exit(1);
    }
}

run();
