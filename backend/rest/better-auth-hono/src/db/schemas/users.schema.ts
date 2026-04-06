import * as p from "drizzle-orm/pg-core";

export const usersTable = p.pgTable("users", {
    id: p.serial().primaryKey(),
    name: p.text().notNull(),
    age: p.integer().notNull(),
    email: p.text().notNull().unique(),
});

export type InsertUser = typeof usersTable.$inferInsert;
export type SelectUser = typeof usersTable.$inferSelect;