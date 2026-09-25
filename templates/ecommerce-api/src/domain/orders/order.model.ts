import { z } from 'zod';

export const OrderSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    items: z.array(
        z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
        }),
    ),
    total: z.number().nonnegative(),
    status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).default('pending'),
    createdAt: z.date().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

export const CreateOrderSchema = z.object({
    userId: z.string().uuid(),
    items: z.array(
        z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
        }),
    ),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
