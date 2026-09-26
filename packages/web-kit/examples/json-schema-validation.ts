import { Kernel } from '../src/kernel';
import { validateJson } from '../src/features/json-schema-validation';

// ============================================================================
// Example: JSON Schema Validation with Custom Error Messages
// ============================================================================

// validateJson() is a plain Hono middleware: no feature to register.
const kernel = new Kernel({ port: 8002 });
await kernel.initialize();

const app = kernel.getApp();

// ── Schema with errorMessage keywords ───────────────────────────────────────
// This schema can be shared as a .json file between frontend and backend.

const createUserSchema = {
    type: 'object',
    properties: {
        name: {
            type: 'string',
            minLength: 2,
            maxLength: 50,
            errorMessage: {
                type: 'Name must be a string',
                minLength: 'Name must be at least 2 characters',
                maxLength: 'Name must be at most 50 characters',
            },
        },
        email: {
            type: 'string',
            format: 'email',
            errorMessage: {
                type: 'Email must be a string',
                format: 'Please provide a valid email address',
            },
        },
        age: {
            type: 'integer',
            minimum: 18,
            maximum: 150,
            errorMessage: {
                type: 'Age must be a number',
                minimum: 'You must be at least 18 years old',
                maximum: 'Age must be 150 or less',
            },
        },
    },
    required: ['name', 'email', 'age'],
    errorMessage: {
        required: {
            name: 'Name is required',
            email: 'Email is required',
            age: 'Age is required',
        },
    },
    additionalProperties: false,
};

// ── Body validation ─────────────────────────────────────────────────────────
// A JSON Schema carries no TypeScript type: name the shape the handler gets.

interface CreateUser {
    name: string;
    email: string;
    age: number;
}

app.post('/users', validateJson<CreateUser>({ body: createUserSchema }), (c) => {
    const { body } = c.get('validated');
    return c.json(
        {
            success: true,
            message: 'User created',
            data: body,
        },
        201,
    );
});

// ── Query parameter validation ──────────────────────────────────────────────

const listUsersQuerySchema = {
    type: 'object',
    properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        sort: { type: 'string', enum: ['name', 'email', 'age'] },
    },
    required: ['page'],
    errorMessage: {
        required: {
            page: 'Page number is required',
        },
    },
};

interface ListUsersQuery {
    page: number;
    limit?: number;
    sort?: 'name' | 'email' | 'age';
}

app.get('/users', validateJson<unknown, ListUsersQuery>({ query: listUsersQuerySchema }), (c) => {
    const { query } = c.get('validated');
    return c.json({
        success: true,
        data: [],
        pagination: query,
    });
});

if (import.meta.main) {
    console.log('Starting JSON Schema Validation Example on port 8002...');
    await kernel.start();
}
