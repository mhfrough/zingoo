import { DataSource } from 'typeorm';

/**
 * Tables that survive "delete business data": the companies, Settings (every field), the lists, currencies and their
 * rates, categories and cost centers, container types, the chart of accounts, the staff logins and the files still
 * used by a kept row (company logos, the platform logo, certificate pictures).
 */
export const KEEP_TABLES = ['settings', 'companies', 'lookups', 'currencies', 'currency_rates', 'categories', 'container_types', 'accounts', 'users', 'attachments'];

export interface ClearResult {
  /** rows removed per table (only tables that had rows) */
  removed: Record<string, number>;
  /** staff logins kept */
  usersKept: number;
}

/**
 * Remove all business data in one transaction: products, manufacturers, distributors and everything under them,
 * every order, request, invoice, payment, claim, export, finance entry, voucher and ledger line, notifications and the
 * audit log. Distributor and manufacturer logins go with their partners; bank accounts owned by a partner go too.
 * Afterwards the seed never loads the sample data again (settings.sampleDataOff).
 */
export async function clearBusinessData(db: DataSource): Promise<ClearResult> {
  // the app keeps running while this works (open pages poll notifications): on a deadlock or a lock wait, try again
  for (let attempt = 1; ; attempt++) {
    try {
      return await clearOnce(db);
    } catch (err: any) {
      const code = err?.driverError?.code ?? err?.code;
      if (attempt >= 5 || (code !== '40P01' && code !== '55P03')) throw err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

async function clearOnce(db: DataSource): Promise<ClearResult> {
  return db.transaction(async (em) => {
    const q = <T = any>(sql: string, params?: unknown[]) => em.query(sql, params) as Promise<T[]>;
    const tables = (await q<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).map((r) => r.t);
    const wipe = tables.filter((t) => !KEEP_TABLES.includes(t) && t !== 'migrations' && t !== 'typeorm_metadata');

    // take every lock at once, before any change, so a request running meanwhile cannot lock in between
    await q(`SET LOCAL lock_timeout = '15s'`);
    await q(`LOCK TABLE ${[...wipe, 'users', 'lookups', 'attachments', 'settings'].map((t) => `"${t}"`).join(', ')} IN ACCESS EXCLUSIVE MODE`);

    const removed: Record<string, number> = {};
    const count = async (t: string, where = '') => Number((await q<{ n: string }>(`SELECT COUNT(*) AS n FROM "${t}" ${where}`))[0].n);
    for (const t of wipe) {
      const n = await count(t);
      if (n) removed[t] = n;
    }

    // partner logins first: they point at the partner rows
    const partnerUsers = `WHERE "distributorId" IS NOT NULL OR "manufacturerId" IS NOT NULL OR role IN ('Distributor', 'Manufacturer')`;
    const nUsers = await count('users', partnerUsers);
    if (nUsers) removed['users'] = nUsers;
    await q(`DELETE FROM users ${partnerUsers}`);

    // a wiped table that a kept table points at cannot be truncated: delete its rows after the rest are gone
    const referenced = new Set(
      (await q<{ ref: string; src: string }>(
        `SELECT DISTINCT ccu.table_name AS ref, tc.table_name AS src
           FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
      ))
        .filter((r) => KEEP_TABLES.includes(r.src) && wipe.includes(r.ref))
        .map((r) => r.ref),
    );
    const truncate = wipe.filter((t) => !referenced.has(t));
    if (truncate.length) await q(`TRUNCATE ${truncate.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
    for (const t of referenced) await q(`DELETE FROM "${t}"`);

    // bank accounts that belonged to a distributor or manufacturer
    const ownedWhere = `WHERE list = 'BANK_ACCOUNT' AND meta->>'ownerType' IN ('Distributor', 'Manufacturer')`;
    const nBanks = await count('lookups', ownedWhere);
    if (nBanks) removed['lookups (partner bank accounts)'] = nBanks;
    await q(`DELETE FROM lookups ${ownedWhere}`);

    // files no kept row uses any more
    const keepFiles = new Set<string>();
    for (const r of await q<{ id: string | null }>(`SELECT "logoId" AS id FROM companies`)) if (r.id) keepFiles.add(r.id);
    for (const r of await q<{ id: string | null }>(`SELECT platform->>'logoId' AS id FROM settings`)) if (r.id) keepFiles.add(r.id);
    for (const r of await q<{ id: string | null }>(`SELECT meta->>'pictureId' AS id FROM lookups WHERE meta ? 'pictureId'`)) if (r.id) keepFiles.add(r.id);
    const files = await q<{ id: string }>(`SELECT id FROM attachments`);
    const drop = files.filter((f) => !keepFiles.has(f.id)).map((f) => f.id);
    if (drop.length) {
      removed['attachments'] = drop.length;
      await q(`DELETE FROM attachments WHERE id = ANY($1::uuid[])`, [drop]);
    }

    await q(`UPDATE settings SET "sampleDataOff" = true`);
    const usersKept = await count('users');
    return { removed, usersKept };
  });
}
