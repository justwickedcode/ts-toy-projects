import { defineConfig } from 'drizzle-kit';
import { configDotenv } from 'dotenv';
configDotenv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schemas/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
