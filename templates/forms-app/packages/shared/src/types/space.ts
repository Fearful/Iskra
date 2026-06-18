export interface Space {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateSpaceInput {
    name: string;
    slug: string;
}

export interface UpdateSpaceInput {
    name?: string;
    slug?: string;
}
