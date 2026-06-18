// mock-process.ts
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();

console.log(JSON.stringify({ status: 'started' }));

let buffer = '';

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last incomplete line

    for (const line of lines) {
        if (!line.trim()) continue;

        // Remove quotes if any (JSON.stringify adds them in send)
        // But send() does JSON.stringify(data), so if data is 'hello', it sends "hello"\n

        if (line.includes('error')) {
            console.error('This is an error');
        } else {
            console.log(JSON.stringify({ received: line.trim() }));
        }
    }
}

export { };
