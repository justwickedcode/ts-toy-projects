import * as bcrypt from 'bcrypt';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import { usersTable } from '../db/schema';
import { eq, or } from 'drizzle-orm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type User = typeof usersTable.$inferSelect;
type SafeUser = Omit<User, 'password'>;

@Injectable()
export class UsersService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly db: DbService) {}

  // Helpers

  private stripPassword({ password: _, ...user }: User): SafeUser {
    return user;
  }

  private hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  private async findUserById(id: number): Promise<User> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!users[0]) throw new NotFoundException('User not found');
    return users[0];
  }

  private async findUserByEmail(email: string): Promise<User> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (!users[0]) throw new NotFoundException('User not found');
    return users[0];
  }

  private async findUserByEmailOrUsername(login: string): Promise<User> {
    const users = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.email, login), eq(usersTable.username, login)))
      .limit(1);
    if (!users[0]) throw new NotFoundException('User not found');
    return users[0];
  }

  // Public

  async findAll(): Promise<SafeUser[]> {
    const users = await this.db.drizzle.select().from(usersTable);
    return users.map((user) => this.stripPassword(user));
  }

  async findOne(id: number): Promise<SafeUser> {
    const user = await this.findUserById(id);
    return this.stripPassword(user);
  }

  async findByEmail(email: string): Promise<SafeUser> {
    const user = await this.findUserByEmail(email);
    return this.stripPassword(user);
  }

  /** @internal Only use in AuthService for password comparison */
  async findForAuth(login: string): Promise<User> {
    return this.findUserByEmailOrUsername(login);
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.db.drizzle
      .select()
      .from(usersTable)
      .where(
        or(
          eq(usersTable.email, dto.email),
          eq(usersTable.username, dto.username),
        ),
      )
      .limit(1);
    if (existing[0])
      throw new ConflictException('Email or username already in use');

    const password = await this.hashPassword(dto.password);
    const created = await this.db.drizzle
      .insert(usersTable)
      .values({ ...dto, password })
      .returning();
    if (!created[0])
      throw new InternalServerErrorException('Could not create user');
    return this.stripPassword(created[0]);
  }

  async update(id: number, dto: UpdateUserDto): Promise<SafeUser> {
    await this.findUserById(id);
    const updated = await this.db.drizzle
      .update(usersTable)
      .set({ ...dto, updated_at: new Date() })
      .where(eq(usersTable.id, id))
      .returning();
    return this.stripPassword(updated[0]);
  }

  async remove(id: number): Promise<SafeUser> {
    await this.findUserById(id);
    const deleted = await this.db.drizzle
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning();
    return this.stripPassword(deleted[0]);
  }
}
