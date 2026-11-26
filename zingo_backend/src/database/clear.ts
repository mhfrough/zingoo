/**
 * Delete all business data and keep the setup (companies, Settings, lists, currencies, categories, cost centers,
 * container types, chart of accounts, staff logins). The sample data is never loaded again afterwards.
 *   npm run db:clear -- --yes
 * The same action is on Settings > Zingo for the super admin.
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { clearBusinessData } from './clear-data';

async function run() {
  if (!process.argv.includes('--yes')) {
    console.log('This deletes every product, partner, order, payment and ledger line. Run again with --yes to go ahead.');
    return;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const { removed, usersKept } = await clearBusinessData(app.get(DataSource));
    const rows = Object.entries(removed).sort((a, b) => b[1] - a[1]);
    for (const [t, n] of rows) console.log(`${String(n).padStart(6)}  ${t}`);
    console.log(`Done. ${rows.reduce((s, [, n]) => s + n, 0)} rows removed from ${rows.length} tables; ${usersKept} staff logins kept.`);
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
