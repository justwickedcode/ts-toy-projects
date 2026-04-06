import { Injectable, OnModuleInit } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { usersTable } from './schemas/users.schema';
import { oauthAccountsTable } from './schemas/oauth_accounts.schema';

const schema = { usersTable, oauthAccountsTable };

@Injectable()
export class DbService implements OnModuleInit {
  private pool!: Pool;
  drizzle!: NodePgDatabase<typeof schema>;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const dbUrl = this.configService.getOrThrow<string>('DATABASE_URL');
    this.pool = new Pool({ connectionString: dbUrl });
    this.drizzle = drizzle(this.pool, { schema });
  }
}
