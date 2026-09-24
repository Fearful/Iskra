export interface User {
    id: number;
    name: string;
}

export class UserService {
    private users: User[] = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
    ];

    async findAll() {
        return this.users;
    }

    async create(name: string) {
        const user = { id: this.users.length + 1, name };
        this.users.push(user);
        return user;
    }
}
