import { z } from 'zod';

export const PostSchema = z.object({
    id: z.string().uuid(),
    content: z.string().min(1).max(280),
    authorId: z.string().uuid(),
    createdAt: z.date(),
});

export type Post = z.infer<typeof PostSchema>;

export const CreatePostSchema = z.object({
    content: z.string().min(1).max(280),
    authorId: z.string().uuid(),
});

export type CreatePostInput = z.infer<typeof CreatePostSchema>;
