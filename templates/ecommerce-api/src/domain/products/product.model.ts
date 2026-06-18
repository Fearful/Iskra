import { z } from 'zod';

export const ProductSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    price: z.number().positive(),
    description: z.string().optional(),
    stock: z.number().int().nonnegative(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
});

export type Product = z.infer<typeof ProductSchema>;

export const CreateProductSchema = ProductSchema.omit({ id: true });
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
