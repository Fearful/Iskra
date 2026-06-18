import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ProductService } from '../../domain/products/product.service.ts';
import { CreateProductSchema } from '../../domain/products/product.model.ts';

const app = new Hono();

app.get('/products', async (c) => {
    const products = await ProductService.findAll();
    return c.json(products);
});

app.get('/products/:id', async (c) => {
    const id = c.req.param('id');
    const product = await ProductService.findById(id);
    if (!product) {
        return c.json({ error: 'Product not found' }, 404);
    }
    return c.json(product);
});

app.post('/products', zValidator('json', CreateProductSchema), async (c) => {
    const input = c.req.valid('json');
    const product = await ProductService.create(input);
    return c.json(product, 201);
});


import { OrderService } from '../../domain/orders/order.service.ts';
import { CreateOrderSchema } from '../../domain/orders/order.model.ts';

// ... existing code ...

app.post('/orders', zValidator('json', CreateOrderSchema), async (c) => {
    const input = c.req.valid('json');
    try {
        const order = await OrderService.create(input);
        return c.json(order, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 400);
    }
});

app.get('/orders', async (c) => {
    const orders = await OrderService.findAll();
    return c.json(orders);
});

export default app;

