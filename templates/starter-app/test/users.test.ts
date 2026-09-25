import { describe, it, expect } from 'bun:test';
import config from '../app.config.ts';
import { UserService } from '../src/domain/user.service.ts';
import { CreateUserSchema } from '../src/interfaces/http/router.ts';

describe('starter-app', () => {
    it('ships without debug logging', () => {
        // The default template shipped debug: true and logger.level: 'debug'.
        expect(config.debug).toBe(false);
        expect(config.logger?.level).toBe('info');
    });

    it('bounds the user name', () => {
        expect(CreateUserSchema.safeParse({ name: 'Ana' }).success).toBe(true);
        expect(CreateUserSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
        expect(CreateUserSchema.safeParse({ name: '   ' }).success).toBe(false);
    });

    it('caps the in-memory store', async () => {
        const users = new UserService(3);
        expect(await users.create('Carol')).toEqual({ id: 3, name: 'Carol' });
        expect(await users.create('Dave')).toBeNull();
        expect(await users.findAll()).toHaveLength(3);
    });
});
