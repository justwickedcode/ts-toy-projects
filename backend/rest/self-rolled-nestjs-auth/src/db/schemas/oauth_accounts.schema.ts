import { pgTable, serial, text, integer, unique } from 'drizzle-orm/pg-core';
import { usersTable } from './users.schema';
import { pgEnum } from 'drizzle-orm/pg-core';

export const providersEnum = pgEnum('providers', ['tmdb', 'github', 'google']);

export const oauthAccountsTable = pgTable(
  'oauth_accounts',
  {
    id: serial().primaryKey(),
    user_id: integer()
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    provider: providersEnum().notNull(),
    provider_id: text().notNull(),
  },
  // for each provider, the provider_id must be unique
  (table) => [unique().on(table.provider, table.provider_id)],
);
