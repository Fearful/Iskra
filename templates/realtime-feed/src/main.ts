import { App } from '@iskra-bun/core';
import { WebPlugin } from '@iskra-bun/web-kit';
import { SocketDriver } from '@iskra-bun/socket-kit';
import { config } from './app.config.ts';
import httpRouter, { eventBus } from './interfaces/http/router.ts';
import { socketRouter } from './interfaces/socket/router.ts';

const app = new App({ name: 'RealtimeFeed' });

// Setup Socket Driver
const socketDriver = new SocketDriver({
    port: config.socket.port,
    router: socketRouter,
});

app.register(socketDriver);

// Setup Web Plugin (Hono)
app.register(
    new WebPlugin({
        port: config.web.port,
        router: httpRouter,
    }),
);

// Connect HTTP events to Socket broadcast
eventBus.on('feed:new-post', (post) => {
    app.logger.info({ msg: 'Broadcasting new post', postId: post.id });
    socketDriver.broadcast('feed:new-post', post);
});

async function main() {
    await app.start();
    console.log('Realtime Feed App started');
}

// Exit 1 on a failed start (e.g. the database is unreachable): with only
// console.error the process exited 0, which restart policies read as success.
main().catch((err) => {
    console.error('Could not start Realtime Feed:', err);
    process.exit(1);
});
