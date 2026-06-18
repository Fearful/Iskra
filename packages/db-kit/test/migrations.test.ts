import { describe, it, expect, afterEach, spyOn } from "bun:test";
import { MigrationHelper, mapDialect } from "../src/migrations";
import { MigrationError } from "../src/errors";

describe("Migration System", () => {
    describe("mapDialect", () => {
        it("should map postgres to postgresql", () => {
            expect(mapDialect("postgres")).toBe("postgresql");
        });

        it("should map mysql to mysql", () => {
            expect(mapDialect("mysql")).toBe("mysql");
        });

        it("should map sqlite to sqlite", () => {
            expect(mapDialect("sqlite")).toBe("sqlite");
        });

        it("should map libsql to sqlite", () => {
            expect(mapDialect("libsql")).toBe("sqlite");
        });

        it("should throw MigrationError for unknown driver", () => {
            try {
                mapDialect("oracle");
                expect(true).toBe(false); // should not reach
            } catch (err) {
                expect(err).toBeInstanceOf(MigrationError);
                expect((err as MigrationError).code).toBe("MIGRATION_ERROR");
            }
        });
    });

    describe("MigrationHelper", () => {
        it("should instantiate with config", () => {
            const helper = new MigrationHelper({
                dialect: "sqlite",
                dbUrl: ":memory:",
                schemaPath: "./src/db/schema.ts",
                migrationsDir: "./drizzle",
            });
            expect(helper).toBeDefined();
        });

        it("should instantiate with app logger", () => {
            const mockApp = {
                logger: {
                    info: () => {},
                    error: () => {},
                },
            } as any;

            const helper = new MigrationHelper(
                {
                    dialect: "postgresql",
                    dbUrl: "postgres://localhost/test",
                    schemaPath: "./schema.ts",
                    migrationsDir: "./drizzle",
                },
                mockApp,
            );
            expect(helper).toBeDefined();
        });
    });

    describe("createDrizzleConfig", () => {
        it("should create a valid config object", async () => {
            const { createDrizzleConfig } = await import("../src/drizzle.config.template");

            const config = createDrizzleConfig({
                dialect: "sqlite",
                dbUrl: "test.db",
                schemaPath: "./src/db/schema.ts",
            });

            expect(config).toBeDefined();
            expect(config.dialect).toBe("sqlite");
            expect(config.schema).toBe("./src/db/schema.ts");
            expect(config.out).toBe("./drizzle"); // default
        });

        it("should use custom migrations dir", async () => {
            const { createDrizzleConfig } = await import("../src/drizzle.config.template");

            const config = createDrizzleConfig({
                dialect: "postgresql",
                dbUrl: "postgres://localhost/db",
                schemaPath: "./schema.ts",
                migrationsDir: "./custom-migrations",
            });

            expect(config.out).toBe("./custom-migrations");
        });
    });

    // Exercises the drizzle-kit subprocess wrapper without invoking the real CLI
    // or a database: Bun.spawn is spied so we assert the command we build, the
    // injected DATABASE_URL, and how exit codes / failures are surfaced.
    describe("MigrationHelper subprocess wrapper", () => {
        let spawnSpy: ReturnType<typeof spyOn> | null = null;
        let lastCmd: string[] | null = null;
        let lastOpts: any = null;

        function mockSpawn(result: { exitCode?: number; stdout?: string; stderr?: string }) {
            spawnSpy = spyOn(Bun, "spawn").mockImplementation(((cmd: string[], opts: any) => {
                lastCmd = cmd;
                lastOpts = opts;
                return {
                    exited: Promise.resolve(result.exitCode ?? 0),
                    stdout: result.stdout ?? "",
                    stderr: result.stderr ?? "",
                };
            }) as any);
        }

        afterEach(() => {
            spawnSpy?.mockRestore();
            spawnSpy = null;
            lastCmd = null;
            lastOpts = null;
        });

        const helper = () =>
            new MigrationHelper({
                dialect: "postgresql",
                dbUrl: "postgres://localhost/test",
                schemaPath: "./schema.ts",
                migrationsDir: "./drizzle",
            });

        it("runs `bunx drizzle-kit migrate` with DATABASE_URL injected", async () => {
            mockSpawn({ exitCode: 0, stdout: "ok" });
            await helper().migrate();
            expect(lastCmd).toEqual(["bunx", "drizzle-kit", "migrate"]);
            expect(lastOpts.env.DATABASE_URL).toBe("postgres://localhost/test");
        });

        it("passes --name to generate when provided", async () => {
            mockSpawn({ exitCode: 0 });
            await helper().generate("add_users");
            expect(lastCmd).toEqual(["bunx", "drizzle-kit", "generate", "--name", "add_users"]);
        });

        it("runs generate without --name when omitted", async () => {
            mockSpawn({ exitCode: 0 });
            await helper().generate();
            expect(lastCmd).toEqual(["bunx", "drizzle-kit", "generate"]);
        });

        it("runs `drizzle-kit push`", async () => {
            mockSpawn({ exitCode: 0 });
            await helper().push();
            expect(lastCmd).toEqual(["bunx", "drizzle-kit", "push"]);
        });

        it("runs `drizzle-kit drop`", async () => {
            mockSpawn({ exitCode: 0 });
            await helper().drop();
            expect(lastCmd).toEqual(["bunx", "drizzle-kit", "drop"]);
        });

        it("throws MigrationError carrying exit code and stderr on failure", async () => {
            mockSpawn({ exitCode: 1, stderr: "schema drift detected" });
            try {
                await helper().migrate();
                expect(true).toBe(false);
            } catch (err) {
                expect(err).toBeInstanceOf(MigrationError);
                expect((err as MigrationError).context).toMatchObject({
                    operation: "migrate",
                    exitCode: 1,
                    stderr: "schema drift detected",
                });
            }
        });

        it("wraps unexpected spawn failures in a MigrationError", async () => {
            spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => {
                throw new Error("spawn exploded");
            }) as any);
            try {
                await helper().push();
                expect(true).toBe(false);
            } catch (err) {
                expect(err).toBeInstanceOf(MigrationError);
                expect((err as MigrationError).message).toContain("push failed");
            }
        });
    });
});
