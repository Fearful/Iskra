import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { mysqlTable, varchar, timestamp as mysqlTimestamp, boolean as mysqlBoolean, text as mysqlText } from "drizzle-orm/mysql-core";
import { sqliteTable, text as sqliteText, integer } from "drizzle-orm/sqlite-core";

// ==========================================
// PostgreSQL Schema
// ==========================================

export const pgUser = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull().unique(),
    emailVerified: boolean("emailVerified").notNull(),
    image: text("image"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull()
});

export const pgSession = pgTable("session", {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull().references(() => pgUser.id)
});

export const pgAccount = pgTable("account", {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => pgUser.id),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull()
});

export const pgVerification = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt"),
    updatedAt: timestamp("updatedAt")
});

export const pgSchema = {
    user: pgUser,
    session: pgSession,
    account: pgAccount,
    verification: pgVerification
};

// ==========================================
// MySQL Schema
// ==========================================

export const mysqlUser = mysqlTable("user", {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }).notNull().unique(),
    emailVerified: mysqlBoolean("emailVerified").notNull(),
    image: varchar("image", { length: 255 }),
    createdAt: mysqlTimestamp("createdAt").notNull(),
    updatedAt: mysqlTimestamp("updatedAt").notNull()
});

export const mysqlSession = mysqlTable("session", {
    id: varchar("id", { length: 36 }).primaryKey(),
    expiresAt: mysqlTimestamp("expiresAt").notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    createdAt: mysqlTimestamp("createdAt").notNull(),
    updatedAt: mysqlTimestamp("updatedAt").notNull(),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: mysqlText("userAgent"),
    userId: varchar("userId", { length: 36 }).notNull().references(() => mysqlUser.id)
});

export const mysqlAccount = mysqlTable("account", {
    id: varchar("id", { length: 36 }).primaryKey(),
    accountId: varchar("accountId", { length: 255 }).notNull(),
    providerId: varchar("providerId", { length: 255 }).notNull(),
    userId: varchar("userId", { length: 36 }).notNull().references(() => mysqlUser.id),
    accessToken: mysqlText("accessToken"),
    refreshToken: mysqlText("refreshToken"),
    idToken: mysqlText("idToken"),
    accessTokenExpiresAt: mysqlTimestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: mysqlTimestamp("refreshTokenExpiresAt"),
    scope: mysqlText("scope"),
    password: varchar("password", { length: 255 }),
    createdAt: mysqlTimestamp("createdAt").notNull(),
    updatedAt: mysqlTimestamp("updatedAt").notNull()
});

export const mysqlVerification = mysqlTable("verification", {
    id: varchar("id", { length: 36 }).primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: varchar("value", { length: 255 }).notNull(),
    expiresAt: mysqlTimestamp("expiresAt").notNull(),
    createdAt: mysqlTimestamp("createdAt"),
    updatedAt: mysqlTimestamp("updatedAt")
});

export const mysqlSchema = {
    user: mysqlUser,
    session: mysqlSession,
    account: mysqlAccount,
    verification: mysqlVerification
};

// ==========================================
// SQLite Schema
// ==========================================

export const sqliteUser = sqliteTable("user", {
    id: sqliteText("id").primaryKey(),
    name: sqliteText("name"),
    email: sqliteText("email").notNull().unique(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
    image: sqliteText("image"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
});

export const sqliteSession = sqliteTable("session", {
    id: sqliteText("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    token: sqliteText("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
    ipAddress: sqliteText("ipAddress"),
    userAgent: sqliteText("userAgent"),
    userId: sqliteText("userId").notNull().references(() => sqliteUser.id)
});

export const sqliteAccount = sqliteTable("account", {
    id: sqliteText("id").primaryKey(),
    accountId: sqliteText("accountId").notNull(),
    providerId: sqliteText("providerId").notNull(),
    userId: sqliteText("userId").notNull().references(() => sqliteUser.id),
    accessToken: sqliteText("accessToken"),
    refreshToken: sqliteText("refreshToken"),
    idToken: sqliteText("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
    scope: sqliteText("scope"),
    password: sqliteText("password"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull()
});

export const sqliteVerification = sqliteTable("verification", {
    id: sqliteText("id").primaryKey(),
    identifier: sqliteText("identifier").notNull(),
    value: sqliteText("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
});

export const sqliteSchema = {
    user: sqliteUser,
    session: sqliteSession,
    account: sqliteAccount,
    verification: sqliteVerification
};
