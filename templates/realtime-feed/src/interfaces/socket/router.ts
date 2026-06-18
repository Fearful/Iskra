import { SocketRouter } from '@iskra-bun/socket-kit';

export const socketRouter = new SocketRouter();

socketRouter.on('ping', (ctx) => {
    ctx.socket.send(JSON.stringify({ type: 'pong' }));
});

socketRouter.on('subscribe', (ctx) => {
    // Logic to subscribe to feed updates could go here
    // For now, we assume all connected clients get updates
    ctx.socket.send(JSON.stringify({ type: 'subscribed', channel: 'feed' }));
});
