# Zingoo - ERP & Distributor Portal (Zen Foods)

Built from the client's prototype `Zingoo_v4_Distributor_Portal.html`. Plan and progress: [PLAN.md](PLAN.md).

```
 manufacturer (3rd party) --cartons--> warehouse --dispatch--> distributors --collections--> cash
        ^ accrued payable                  ^ stock                 ^ receivable
 capital in / spend out (two signatures above a threshold) / income + bills / exports in foreign currency
                      everything above posts to one double-entry journal
```

## Folders

```
zingo/
  zingo_backend/    NestJS + TypeORM + PostgreSQL + Swagger   (port 3020, docs at /api/docs)
  zingo_frontend/   Angular 21, token CSS + native nesting    (port 4270, portal at /admin)
  PLAN.md           phases and status
```

### Backend `zingo_backend/src` (one folder per area)

| Folder | What it holds |
| --- | --- |
| `auth`, `users` | login (JWT), roles guard, signing seats |
| `setup` | settings (threshold, packs per carton ...), currencies, chart of accounts, cost centers + budgets, container types |
| `catalog` | products (SKUs), manufacturers, distributors, agreed rates; `StockService` (stock + average cost) |
| `manufacturing` | production batches (Planned -> Released), manufacturer payments |
| `distribution` | sales orders (Draft -> Dispatched), collections |
| `finance` | finance entries (capital, spend, assets, receipts), accounting documents (income invoices, expense bills), settlements, approvals (signatures) |
| `ledger` | `ledger_entries` (journal lines), `PostingService` (documents -> journal), manual vouchers table |
| `exports`, `portal` | tables only for now (phases 5 and 7) |
| `reports` | dashboard, stock, income statement, trial balance, cash book, journal, receivables, payables, budgets, alerts |
| `database` | `seed-data.ts` (the client's sample data), `seed.ts`, `reset.ts` |
| `common` | enums, base entities, `CrudService`, `CrudController`, reference numbers |

## How posting works

Every document writes its journal lines through `PostingService.sync*()`. It works out what the document should look like in the ledger **right now** and rewrites it, so calling it again is always safe.

| Document | Debit | Credit | Posts when |
| --- | --- | --- | --- |
| Batch | Inventory | Manufacturer Payable | Released |
| Manufacturer payment | Manufacturer Payable | Cash & Bank | created |
| Sales order | Accounts Receivable | Sales Revenue | Dispatched |
| ... same order | Cost of Goods Sold | Inventory | Dispatched (unit cost frozen at dispatch) |
| Collection | Cash & Bank | Accounts Receivable | created |
| Capital | Cash & Bank | Owner Equity or Partner Loans | created |
| Operating expense | Expense · category | Cash & Bank | enough signatures |
| Asset purchase | Fixed Assets | Cash & Bank | enough signatures |
| Other receipt | Cash & Bank | Other Income | created |
| Income invoice | Accounts Receivable | Income · category | created |
| Expense bill | Expense · category | Accounts Payable | enough signatures |
| Settlement | Cash & Bank / Accounts Payable | Accounts Receivable / Cash & Bank | document approved |

Signatures: spend below the threshold needs 1, at or above it needs 2 (seat A and seat B). Changing the threshold re-checks every pending document.
Stock (cartons) = released batches - dispatched orders - shipped exports. Invoice = cartons x packs per carton x price per pack.

## Roles

| Role | Can open | Can change |
| --- | --- | --- |
| Admin | everything | everything |
| Manufacturing | overview, manufacturing, pricing | manufacturing |
| Finance | overview, finance, accounting, ledger, pricing, exports, settings, portal | finance, exports |
| Distribution | overview, distribution, pricing, portal | distribution |
| Exports | overview, exports, pricing, distribution | exports, distribution |
| Viewer | all internal pages | nothing |
| Distributor | partner portal only | own requests and payments (phase 7) |

Users also have a signing seat: `A`, `B`, `Both` or `None`.

## Run

```bash
cd zingo_backend
# .env: set DB_PASSWORD, create an empty database named in DB_DATABASE
npm run seed:fresh     # wipes the schema, creates tables, loads the client's data, checks it against the prototype
npm run start:dev      # API on http://localhost:3020/api   (Swagger: /api/docs)
npm run test:api       # 54 rule checks (changes data; run seed:fresh afterwards)

cd ../zingo_frontend
npm start              # http://localhost:4270/admin
```

**Root account.** `ROOT_EMAIL`, `ROOT_PASSWORD` and `ROOT_NAME` in `zingo_backend/.env` define the highest-level account (role Admin, signing seat Both, `isRoot`). It is created by `npm run seed` and re-checked every time the API starts, but never overwritten once it exists, so a password changed later in the app is kept. `.env` is git-ignored; `.env.example` only has placeholders.

**Credit hold.** A draft order that would take a distributor over their credit limit cannot be dispatched (a limit of 0 means no limit). Finance or Admin can override with a reason, which is written to the audit log.

Sample logins (all use `SEED_PASSWORD` from `.env`): `owner@example.test` (Admin, seat Both), `factory@example.test`, `finance@example.test` (seat A), `partner@example.test` (Finance, seat B), `sales@example.test`, `export@example.test`, `audit@example.test` (Viewer), `distributor@demo.local`.

## Not built yet

Phases 3-8 in PLAN.md: every page, form and table in the portal; export containers; manual vouchers; user and settings screens; the distributor self-service portal; migrations (dev uses `DB_SYNC=true`).
