import { Post } from './post.model.ts';
import { v4 as uuidv4 } from 'uuid';

// In-memory store
const posts: Post[] = [];

export class FeedService {
    /** `authorId` es el del autor autenticado (el router lo toma de la API key). */
    static async create(input: Omit<Post, 'id' | 'createdAt'>): Promise<Post> {
        const post: Post = {
            id: uuidv4(),
            ...input,
            createdAt: new Date(),
        };
        posts.unshift(post); // Add to top
        // Limit to 100 posts for this demo
        if (posts.length > 100) {
            posts.pop();
        }
        return post;
    }

    static async getLatest(limit = 20): Promise<Post[]> {
        return posts.slice(0, limit);
    }
}
