export interface User {
    id: number;
    name: string;
}

/**
 * Users in memory, for the example. Capped: every POST /users used to add one
 * for good, so anyone could grow the process's memory without limit. Swap it
 * for a database (db-kit) in a real app.
 */
export class UserService {
    private users: User[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
    ];

    constructor(private readonly maxUsers = 1000) {}

    async findAll() {
        return this.users;
    }

    /** The new user, or null when the store is full. */
    async create(name: string): Promise<User | null> {
        if (this.users.length >= this.maxUsers) return null;
        const user = { id: this.users.length + 1, name };
        this.users.push(user);
        return user;
    }
}
