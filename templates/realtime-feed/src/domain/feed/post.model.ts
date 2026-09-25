import { z } from 'zod';

export const PostSchema = z.object({
    id: z.string().uuid(),
    content: z.string().min(1).max(280),
    /** El autor de la API key que publico el post (ver src/auth.ts). */
    authorId: z.string().min(1),
    createdAt: z.date(),
});

export type Post = z.infer<typeof PostSchema>;

/** El cuerpo de POST /feed: sin `authorId`, que sale de la API key (si llega, se ignora). */
export const CreatePostSchema = z.object({
    content: z.string().min(1).max(280),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;
