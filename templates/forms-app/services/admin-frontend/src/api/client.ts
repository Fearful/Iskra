const BASE_URL = '/api';

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
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
}

// Spaces
export const spacesApi = {
    list: () => request<{ data: any[] }>('/spaces'),
    get: (id: string) => request<{ data: any }>(`/spaces/${id}`),
    create: (data: { name: string; slug: string }) =>
        request<{ data: any }>('/spaces', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { name?: string; slug?: string }) =>
        request<{ data: any }>(`/spaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
        request<{ data: any }>(`/spaces/${id}`, { method: 'DELETE' }),
};

// Forms
export const formsApi = {
    listBySpace: (spaceId: string) => request<{ data: any[] }>(`/spaces/${spaceId}/forms`),
    get: (id: string) => request<{ data: any }>(`/forms/${id}`),
    create: (spaceId: string, data: any) =>
        request<{ data: any }>(`/spaces/${spaceId}/forms`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) =>
        request<{ data: any }>(`/forms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
        request<{ data: any }>(`/forms/${id}`, { method: 'DELETE' }),
    publish: (id: string) =>
        request<{ data: any }>(`/forms/${id}/publish`, { method: 'POST' }),
    prerender: (id: string) =>
        request<{ data: any }>(`/forms/${id}/prerender`, { method: 'POST' }),
    getAnswers: (id: string, page = 1, pageSize = 50) =>
        request<any>(`/forms/${id}/answers?page=${page}&pageSize=${pageSize}`),
};

// Auth (Better Auth routes served by admin-api under /api/auth)
export const authApi = {
    signIn: (email: string, password: string) =>
        request<{ user: any }>('/auth/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) }),
    signOut: () => request<{ success: boolean }>('/auth/sign-out', { method: 'POST', body: '{}' }),
};
