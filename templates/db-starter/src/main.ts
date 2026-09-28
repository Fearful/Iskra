import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import { OracleDriver } from '@iskra-bun/db-oracle';
import { OracleUserService, type OracleDB } from './domain/oracle-user.service';
import { UserService } from './domain/user.service';
import { users } from './db/schema';
import { createRouter } from './interfaces/http/router';

const app = new App({
    name: 'DbStarter',
    db: {
        driver: 'sqlite',
        url: process.env.DATABASE_URL || ':memory:',
    },
});

const db = new DbDriver<{ users: typeof users }>();
// Optional: without ORA_CONN (or an `oracle` config section) it does not start.
const oracle = new OracleDriver<OracleDB>();

const userService = new UserService(db);
const routes = createRouter(userService, new OracleUserService(oracle));

app.register(
    new WebDriver({
        port: Number(process.env.PORT) || 3000,
        routes,
    }),
);

app.register(db);
app.register(oracle);

app.start()
    .then(async () => {
        await userService.initTable();
        if (oracle.db) await oracle.runMigrations('./migrations/oracle');
    })
    .catch(console.error);
