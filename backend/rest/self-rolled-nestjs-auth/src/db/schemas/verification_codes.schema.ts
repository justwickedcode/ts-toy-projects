import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema';

export const verificationTypeEnum = pgEnum('verification_type', [
  'mfa',
  'email_validation',
]);

export const verificationCodesTable = pgTable('verification_codes', {
  id: serial().primaryKey(),
  user_id: integer()
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  code: text().notNull(),
  type: verificationTypeEnum().notNull(),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  used_at: timestamp({ withTimezone: true }),
  expires_at: timestamp({ withTimezone: true }).notNull(),
});
