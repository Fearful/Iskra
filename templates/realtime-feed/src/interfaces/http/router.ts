import { Hono, type MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { requireScope } from '@iskra-bun/web-kit';
import { FeedService } from '../../domain/feed/feed.service.ts';
import { CreatePostSchema } from '../../domain/feed/post.model.ts';
import { currentAuthorId } from '../../auth.ts';
import { EventEmitter } from 'node:events';

// Simple event bus for this template
export const eventBus = new EventEmitter();

// Publicar exige una API key de autor (ver src/auth.ts); leer es publico.
const authorsOnly: MiddlewareHandler = requireScope('feed:post');

const app = new Hono();

app.get('/feed', async (c) => {
    const posts = await FeedService.getLatest();
    return c.json(posts);
});

app.post('/feed', authorsOnly, zValidator('json', CreatePostSchema), async (c) => {
    const input = c.req.valid('json');
    // El autor es el de la clave, nunca uno que mande el cliente.
    const post = await FeedService.create({ ...input, authorId: currentAuthorId(c) });

    // Emit event for real-time updates
    eventBus.emit('feed:new-post', post);

    return c.json(post, 201);
});

export default app;
