import { usersTable } from '../schemas/users.schema';

export type User = typeof usersTable.$inferSelect;
export type SafeUser = Pick<
  User,
  'id' | 'username' | 'email' | 'created_at' | 'updated_at'
>;
