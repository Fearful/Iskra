import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const products = sqliteTable('products', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    price: real('price').notNull(),
    stock: integer('stock').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const orders = sqliteTable('orders', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    total: real('total').notNull(),
    status: text('status').notNull().default('pending'), // pending, paid, shipped, cancelled
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const orderItems = sqliteTable('order_items', {
    id: text('id').primaryKey(),
    orderId: text('order_id')
        .notNull()
        .references(() => orders.id),
    productId: text('product_id')
        .notNull()
        .references(() => products.id),
    quantity: integer('quantity').notNull(),
    price: real('price').notNull(),
});
