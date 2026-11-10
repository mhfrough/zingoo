/**
 * Dev only: wipes the whole database schema so `npm run seed` starts from nothing.
 *   npm run db:reset
 * Uses the DB_* values from .env. Never run this against real data.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const db = process.env.DB_DATABASE;
  if (!db) throw new Error('DB_DATABASE is missing in .env');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.');

  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD,
    database: db,
  });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.end();
  console.log(`Schema of "${db}" wiped.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
