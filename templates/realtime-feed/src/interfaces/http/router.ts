import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { FeedService } from '../../domain/feed/feed.service.ts';
import { CreatePostSchema } from '../../domain/feed/post.model.ts';
import { EventEmitter } from 'node:events';

// Simple event bus for this template
export const eventBus = new EventEmitter();

const app = new Hono();

app.get('/feed', async (c) => {
    const posts = await FeedService.getLatest();
    return c.json(posts);
});

app.post('/feed', zValidator('json', CreatePostSchema), async (c) => {
    const input = c.req.valid('json');
    const post = await FeedService.create(input);

    // Emit event for real-time updates
    eventBus.emit('feed:new-post', post);

    return c.json(post, 201);
});

export default app;
