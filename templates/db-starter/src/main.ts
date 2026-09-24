import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { OracleDriver } from '@iskra-bun/db-oracle';
import { UserService } from './domain/user.service';
import { users } from './db/schema';
import { createRouter } from './interfaces/http/router';

const app = new App({
    name: 'DbStarter',
    db: {
        driver: 'sqlite',
        url: process.env.DATABASE_URL || ':memory:'
    }
});

const db = new DbDriver<{ users: typeof users }>();
const oracle = new OracleDriver(); // Will skip if no env vars

const userService = new UserService(db);
const routes = createRouter(userService);

app.register(new WebDriver({
    port: Number(process.env.PORT) || 3000,
    routes
}));

app.register(db);
app.register(oracle);

app.start().then(async () => {
    await userService.initTable();
}).catch(console.error);
