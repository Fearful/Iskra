import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { requireApiKey, requireScope } from '@iskra-bun/web-kit';
import { ProductService } from '../../domain/products/product.service.ts';
import { CreateProductSchema } from '../../domain/products/product.model.ts';
import { OrderError, OrderService } from '../../domain/orders/order.service.ts';
import { CreateOrderSchema } from '../../domain/orders/order.model.ts';
import { currentUserId } from '../../auth.ts';

// El catalogo es publico; el resto exige una API key (ver src/auth.ts). La
// autenticacion va antes que la validacion: sin clave responde 401, no 400.
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

// Solo admins: el precio y el stock los fija la tienda.
app.post('/products', requireScope('products:write'), zValidator('json', CreateProductSchema), async (c) => {
    const input = c.req.valid('json');
    const product = await ProductService.create(input);
    return c.json(product, 201);
});

// La orden es del usuario de la API key, nunca de un userId del cuerpo.
app.post('/orders', requireScope('orders:write'), zValidator('json', CreateOrderSchema), async (c) => {
    const input = c.req.valid('json');
    try {
        const order = await OrderService.create(currentUserId(c), input);
        return c.json(order, 201);
    } catch (e) {
        // Solo los rechazos de negocio llegan al cliente; otro error es un 500 generico.
        if (e instanceof OrderError) return c.json({ error: e.message }, 400);
        throw e;
    }
});

// Cada usuario ve sus ordenes; todas, solo quien tiene `orders:read:all` (admin).
app.get('/orders', requireApiKey(), async (c) => {
    const readAll = c.get('hasScope')?.('orders:read:all') ?? false;
    const orders = readAll ? await OrderService.findAll() : await OrderService.findByUser(currentUserId(c));
    return c.json(orders);
});

export default app;
