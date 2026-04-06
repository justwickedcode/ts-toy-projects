import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema';

export const passwordResetTokensTable = pgTable('password_reset_tokens', {
  id: serial().primaryKey(),
  user_id: integer()
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  token_hash: text().notNull(),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  used_at: timestamp({ withTimezone: true }),
  expires_at: timestamp({ withTimezone: true }).notNull(),
});
