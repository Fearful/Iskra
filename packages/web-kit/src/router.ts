import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { App } from '@iskra-bun/core';
import type { Driver } from '@iskra-bun/core';

export interface RouteOptions<B = any, Q = any> {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    schema?: {
        body?: z.ZodType<B>;
        query?: z.ZodType<Q>;
        params?: z.ZodType;
    };
    handler: (ctx: WebContext<B, Q>) => Promise<any> | any;
    doc?: {
        summary?: string;
        tags?: string[];
        description?: string;
    };
}

export interface WebContext<B = any, Q = any> {
    raw: Context;
    body: B;
    query: Q;
    params: Record<string, string>;
    app: App;
}

export const createRouter = (routes: RouteOptions[]) => routes;
