import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import { and, eq, or } from 'drizzle-orm';
import { CreateOAuthUserDto, CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { usersTable } from '../db/schemas/users.schema';
import { oauthAccountsTable } from '../db/schemas/oauth_accounts.schema';
import { Providers } from '../auth/enums/providers.enums';
import { SafeUser, User } from '../db/types/user.type';

@Injectable()
export class UsersService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly db: DbService) {}

  // Helpers

  private stripSensitive(user: User): SafeUser {
    const { id, username, email, created_at, updated_at } = user;
    return { id, username, email, created_at, updated_at };
  }

  private hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  // Query helpers (return null)

  private async queryUserById(id: number): Promise<User | null> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return users[0] ?? null;
  }

  public async queryUserByEmail(email: string): Promise<User | null> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return users[0] ?? null;
  }

  private async queryUserByUsername(username: string): Promise<User | null> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    return users[0] ?? null;
  }

  private async queryUserByEmailOrUsername(
    login: string,
  ): Promise<User | null> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.email, login), eq(usersTable.username, login)))
      .limit(1);
    return users[0] ?? null;
  }

  // Guarded helpers (throw if not found)

  private async getUserById(id: number): Promise<User> {
    const user = await this.queryUserById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async getUserByEmail(email: string): Promise<User> {
    const user = await this.queryUserByEmail(email);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async getUserByEmailOrUsername(login: string): Promise<User> {
    const user = await this.queryUserByEmailOrUsername(login);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Public

  async findAll(): Promise<SafeUser[]> {
    const users = await this.db.drizzle.select().from(usersTable);
    return users.map((user) => this.stripSensitive(user));
  }

  async findOne(id: number): Promise<SafeUser> {
    const user = await this.getUserById(id);
    return this.stripSensitive(user);
  }

  async findByEmail(email: string): Promise<SafeUser> {
    const user = await this.getUserByEmail(email);
    return this.stripSensitive(user);
  }

  async isEmailVerified(userId: number): Promise<boolean> {
    const user = await this.getUserById(userId);
    return user.is_email_verified;
  }

  /** @internal Only use in AuthService for password comparison */
  async findForAuth(login: string): Promise<User> {
    return this.getUserByEmailOrUsername(login);
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.queryUserByEmailOrUsername(dto.email);
    const existingUsername = await this.queryUserByUsername(dto.username);
    if (existing || existingUsername)
      throw new ConflictException('Email or username already in use');

    const password = await this.hashPassword(dto.password);
    const created = await this.db.drizzle
      .insert(usersTable)
      .values({ ...dto, password })
      .returning();
    if (!created[0])
      throw new InternalServerErrorException('Could not create user');
    return this.stripSensitive(created[0]);
  }

  private async createOAuthUser(dto: CreateOAuthUserDto): Promise<SafeUser> {
    const password = await this.hashPassword(crypto.randomUUID());
    const created = await this.db.drizzle
      .insert(usersTable)
      .values({ ...dto, password })
      .returning();
    if (!created[0])
      throw new InternalServerErrorException('Could not create user');
    return this.stripSensitive(created[0]);
  }

  async findOrCreateOAuthUser(
    profile: { id: string; username: string; email: string },
    provider: Providers,
  ): Promise<SafeUser> {
    const oauthAccounts = await this.db.drizzle
      .select()
      .from(oauthAccountsTable)
      .where(
        and(
          eq(oauthAccountsTable.provider, provider),
          eq(oauthAccountsTable.provider_id, profile.id),
        ),
      )
      .limit(1);

    if (oauthAccounts[0]) {
      return this.findOne(oauthAccounts[0].user_id);
    }

    let user: SafeUser;
    const existingUser = await this.queryUserByEmail(profile.email);

    if (existingUser) {
      user = this.stripSensitive(existingUser);
    } else {
      const usernameTaken = await this.queryUserByUsername(profile.username);
      if (!usernameTaken) {
        user = await this.createOAuthUser({
          username: profile.username,
          email: profile.email,
        });
      } else {
        const suffix = crypto.randomBytes(4).toString('hex');
        const fallbackUsername = `${profile.username}_${suffix}`;
        user = await this.createOAuthUser({
          username: fallbackUsername,
          email: profile.email,
        });
      }
    }

    await this.db.drizzle.insert(oauthAccountsTable).values({
      user_id: user.id,
      provider,
      provider_id: profile.id,
    });

    return user;
  }

  async update(id: number, dto: UpdateUserDto): Promise<SafeUser> {
    await this.getUserById(id);
    const updated = await this.db.drizzle
      .update(usersTable)
      .set({ ...dto, updated_at: new Date() })
      .where(eq(usersTable.id, id))
      .returning();
    return this.stripSensitive(updated[0]);
  }

  async hasMFAActive(userId: number): Promise<boolean> {
    const user = await this.getUserById(userId);
    return user.mfa_active;
  }

  async activateMFA(userId: number, totp_secret: string) {
    await this.getUserById(userId);
    await this.db.drizzle
      .update(usersTable)
      .set({
        updated_at: new Date(),
        mfa_active: true,
        mfa_default_method: 'totp',
        totp_secret: totp_secret,
      })
      .where(eq(usersTable.id, userId));
  }

  async disableMFA(userId: number) {
    await this.getUserById(userId);
    await this.db.drizzle
      .update(usersTable)
      .set({
        updated_at: new Date(),
        mfa_active: false,
        mfa_default_method: null,
        totp_secret: null,
      })
      .where(eq(usersTable.id, userId));
  }

  async getUserPasswordHash(userId) {
    const user = await this.getUserById(userId);
    return user.password;
  }

  async activateEmailMFA(userId: number) {
    await this.getUserById(userId);
    await this.db.drizzle
      .update(usersTable)
      .set({
        updated_at: new Date(),
        mfa_active: true,
        mfa_default_method: 'email',
      })
      .where(eq(usersTable.id, userId));
  }

  async getMfaData(userId: number) {
    const user = await this.getUserById(userId);
    return {
      mfa_active: user.mfa_active,
      mfa_default_method: user.mfa_default_method,
      totp_secret: user.totp_secret,
    };
  }

  async updatePassword(userId: number, newPassword: string): Promise<void> {
    await this.getUserById(userId);
    const hashed = await this.hashPassword(newPassword);
    await this.db.drizzle
      .update(usersTable)
      .set({
        updated_at: new Date(),
        password: hashed,
      })
      .where(eq(usersTable.id, userId));
  }

  async remove(id: number): Promise<SafeUser> {
    await this.getUserById(id);
    const deleted = await this.db.drizzle
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning();
    return this.stripSensitive(deleted[0]);
  }
}
