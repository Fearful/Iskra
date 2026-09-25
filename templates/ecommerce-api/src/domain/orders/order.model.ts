import { z } from 'zod';

/** Topes por orden: una sola orden no puede reservar todo el stock. */
export const MAX_LINES_PER_ORDER = 20;
export const MAX_QUANTITY_PER_LINE = 20;
export const MAX_UNITS_PER_ORDER = 50;

const OrderItemSchema = z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(MAX_QUANTITY_PER_LINE),
});

export const OrderSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().min(1),
    items: z.array(OrderItemSchema),
    total: z.number().nonnegative(),
    status: z.enum(['pending', 'paid', 'shipped', 'cancelled']).default('pending'),
    createdAt: z.date().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

/**
 * El cuerpo de POST /orders. No lleva `userId`: la orden es del usuario de la
 * API key (antes cualquiera podia comprar a nombre de otro); si llega, se ignora.
 */
export const CreateOrderSchema = z.object({
    items: z
        .array(OrderItemSchema)
        .min(1)
        .max(MAX_LINES_PER_ORDER)
        .refine((items) => items.reduce((units, item) => units + item.quantity, 0) <= MAX_UNITS_PER_ORDER, {
            message: `Una orden lleva hasta ${MAX_UNITS_PER_ORDER} unidades`,
        }),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
