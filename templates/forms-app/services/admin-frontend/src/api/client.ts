import type {
    Answer,
    CreateFieldInput,
    CreateFormInput,
    Form,
    FormWithFields,
    PaginatedResponse,
    Space,
    UpdateFormInput,
} from '@forms-app/shared';

// nginx (and the Vite dev proxy) route /admin/api/* to admin-api's /api/*.
const BASE_URL = '/admin/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
        ...options,
    });

    if (res.status === 401 && !path.startsWith('/auth/')) {
        // Session missing or expired: every admin endpoint requires one.
        window.location.assign('/admin/login');
        throw new Error('Unauthorized');
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        // Iskra errors carry `error`; Better Auth's (sign-in) carry `message`.
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }

    return res.json();
}

/** A value as the API's JSON carries it: its dates are ISO strings. */
export type Json<T> = T extends Date
    ? string
    : T extends (infer U)[]
      ? Json<U>[]
      : T extends object
        ? { [K in keyof T]: Json<T[K]> }
        : T;

/**
 * A field as the form builder edits it: its type is the <select>'s value, a
 * string, which admin-api checks against FIELD_TYPES.
 */
export type FieldRequest = Omit<CreateFieldInput, 'fieldType'> & { fieldType: string };
export type CreateFormRequest = Omit<CreateFormInput, 'fields'> & { fields: FieldRequest[] };
export type UpdateFormRequest = Omit<UpdateFormInput, 'fields'> & { fields?: FieldRequest[] };

/** The message of what a request threw (an Error from `request`, or fetch's own). */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// Spaces
export const spacesApi = {
    list: () => request<{ data: Json<Space>[] }>('/spaces'),
    get: (id: string) => request<{ data: Json<Space> }>(`/spaces/${id}`),
    create: (data: { name: string; slug: string }) =>
        request<{ data: Json<Space> }>('/spaces', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; slug?: string }) =>
        request<{ data: Json<Space> }>(`/spaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ data: { ok: true } }>(`/spaces/${id}`, { method: 'DELETE' }),
};

// Forms
export const formsApi = {
    listBySpace: (spaceId: string) => request<{ data: Json<Form>[] }>(`/spaces/${spaceId}/forms`),
    get: (id: string) => request<{ data: Json<FormWithFields> }>(`/forms/${id}`),
    create: (spaceId: string, data: CreateFormRequest) =>
        request<{ data: Json<FormWithFields> }>(`/spaces/${spaceId}/forms`, {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: UpdateFormRequest) =>
        request<{ data: Json<FormWithFields> }>(`/forms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<{ data: { ok: true } }>(`/forms/${id}`, { method: 'DELETE' }),
    publish: (id: string) => request<{ data: { status: 'scheduled' } }>(`/forms/${id}/publish`, { method: 'POST' }),
    // form-manager's response, passed through as is.
    prerender: (id: string) => request<{ data: unknown }>(`/forms/${id}/prerender`, { method: 'POST' }),
    getAnswers: (id: string, page = 1, pageSize = 50) =>
        request<Json<PaginatedResponse<Answer>>>(`/forms/${id}/answers?page=${page}&pageSize=${pageSize}`),
};

// Auth (Better Auth routes served by admin-api under /api/auth)
export const authApi = {
    signIn: (email: string, password: string) =>
        request<{ user: unknown }>('/auth/sign-in/email', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        }),
    signOut: () => request<{ success: boolean }>('/auth/sign-out', { method: 'POST', body: '{}' }),
};
