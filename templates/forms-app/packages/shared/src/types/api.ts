export interface ApiResponse<T = unknown> {
    data?: T;
    error?: string;
    errors?: Record<string, string>;
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface PaginationParams {
    page?: number;
    pageSize?: number;
}
