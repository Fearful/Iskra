console.log(JSON.stringify({ type: 'worker:init', msg: 'Worker started!' }));

// Echo/Ping loop
setInterval(() => {
    console.log(
        JSON.stringify({
            type: 'worker:ping',
            time: Date.now(),
            memory: process.memoryUsage().heapUsed,
        }),
    );
}, 5000);
