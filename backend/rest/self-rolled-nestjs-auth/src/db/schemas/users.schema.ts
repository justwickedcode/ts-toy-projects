import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';

export const mfaMethodEnum = pgEnum('mfa_method', ['totp', 'email']);

// TODO: CAREFUL, YOU'RE LEAKING YOUR CREDENTIALS NOW
// MAKE SURE TO STRIP THEM OFF!!
export const usersTable = pgTable('users', {
  id: serial().primaryKey(),
  username: text().unique().notNull(),
  email: text().unique().notNull(),
  is_email_verified: boolean().notNull().default(false),
  password: text().notNull(),
  mfa_active: boolean().notNull().default(false),
  totp_secret: text(),
  mfa_default_method: mfaMethodEnum(),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
