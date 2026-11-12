# Zingo Distributor Portal v2 - Plan

Source: client prototype `Zingoo_v4_Distributor_Portal.html` (221 KB, one file, localStorage only).
Goal: rebuild it as the real app (Angular + NestJS + PostgreSQL) with a polished theme, every form, every table, the client's dummy data.

This plan **replaces my first guess** of the business. The client's v4 model is richer and different (see section 3).

## Status

| Phase | State |
| --- | --- |
| 1 Design system | **Done** (2026-11-10). Open `/admin/ui` after login. Production build: initial JS+CSS 89 KB gzipped (the Bootstrap build was far larger). |
| 2 Schema + data | **Done** (2026-11-10). 29 tables, double-entry posting engine, roles + seats, 42 API paths, client seed. Prototype parity: 12 of 12 checks pass; API rule smoke test: 49 of 49 (`npm run test:api`). |
| 3 Operations pages | **Done** (2026-11-10). Overview, Manufacturing, Distribution: 7 forms, 8 tables, confirm dialogs, credit hold with Finance override, role-aware menu / buttons / page guard (checked as Admin, Manufacturing and Viewer), root account. 54 API rule checks pass. |
| 4 Money pages | **Done** (2026-11-10). Investment & Finance (capital, two-signature approval desk, budgets, cost centers, capital target) and Income & Expenses (invoices and bills in any currency, part collections and payments, income statement, journal, cash book, period selector, CSV export): 8 forms, 9 tables, confirm dialogs, role-aware buttons (checked as Admin and Viewer), no page scroll at 1440 / 1024 / 820 / 390 / 320. New `GET /reports/cash-flows`; 56 API rule checks pass. |
| 5 Trade pages | **Done** (2026-11-10). Pricing & Margins (price bridge, rate cards, margins, agreed rates), Export Containers (quote, Incoterm costing, ship, foreign-currency collections with FX gain / loss, cost payments) and General Ledger (trial balance, account ledger, profit and loss with cash flows, balance sheet, journal vouchers with reversal, chart of accounts, aged receivables). 10 forms, 18 tables. New endpoints for exports, vouchers, accounts, agreed rates, account ledger, balance sheet and ageing; exports now count in receivables and payables. 99 API rule checks pass. Design pass at the same time: one 0.45rem corner radius and a tighter compact scale (spacing, controls, cards, tables). |
| 6 Admin pages | **Done** (2026-11-11). Settings & Data (company and assumptions, document prefixes, aging buckets, number format applied app-wide, payment methods, Incoterms with the cost lines the seller carries, container types, currencies and rates, categories and cost centers with rename / delete rules, manufacturers and distributors, full CSV export) and Users & Roles (add / edit / switch off / reset password, root and last-Admin protection, permission matrix). Forms now read their options from the database (`SettingsStore`), not from code. 144 API rule checks pass. Client rule met: "everything is controlled from settings". |
| 7 Distributor partner portal | **Done** (2026-11-11). One portal page, two views: a Distributor login sees only its own account (dashboard, orders and stock requests, cargo receipt and damage claims, payments and credit, agreed SKU rates, statement and vouchers, CSV); staff pick any distributor and also get the Zingo approval desk (accept requests into draft sales orders, verify payment advices, approve or reject claims, activity log). Money rules: a payment advice is not cash until Finance confirms it; payments before dispatch are held as customer advances and applied at dispatch; an approved claim posts a credit note (excess over the open invoice is credit owed back). A distributor login lands on the portal and cannot reach any staff data. 193 API rule checks pass. |
| 8 | Not started: polish and QA across every page, then the platform upgrade (section 9). |
| 9 Platform upgrade | Queued after phase 8 (the user chose to finish phases 3-8 first). The design session keeps working on the design-system items in 9.2 (U1) in parallel; platform services (U2) and docs (U4) are stopped. |

Phase 2 scope note: tables for exports, manual journal vouchers and the partner portal exist and are seeded where the client had data, but their **endpoints and posting** come with their own phase (5 and 7), so they are tested with real screens. Also deferred to later phases: users / currencies / chart-of-accounts CRUD (6), distributor credit-limit check at dispatch (3), advance and credit-note postings (7).

Phase 1 checks that passed: 23 colour pairs at WCAG AA (script), no horizontal scroll at 1440 / 1024 / 820 / 390 / 320, 44 px controls on tablet and phone, no console errors, drawer menu, table folds at 900 px and becomes cards at 640 px.

---

## 1. What the prototype contains

Pages (sidebar):
Overview - Manufacturing - Investment & Finance - Income & Expenses - Pricing & Margins - Export Containers - General Ledger - Distribution - Distributor Self-Service (partner portal) - Users & Roles - Settings & Data.

Business flow: manufacturer (third party) makes cartons -> QC -> release into warehouse -> sales order to a distributor -> dispatch (stock down, receivable up) -> collections. Money side: capital in, spend with **dual-signature approval** (2 signers at or above a threshold), income/expense bills with partial settlement, export shipments in foreign currency, and a **double-entry journal** that every event posts to.

Forms found (35): product/SKU, production batch, pay manufacturer, sales order, collect payment, distributor, finance entry, income/expense document, settle document, budget / cost center, export quotation, export container costing, collect export invoice, pay export costs, journal voucher (multi-line), chart-of-accounts entry, currency, container type, manufacturer, user, assign distributor, operating assumption, payment-cycle master, distributor terms, agreed SKU rate, credit-hold override, replenishment request, accept request, cargo receipt / proof of delivery, damage claim approval, installment / advance payment, setup edits.

Tables found (about 45): see section 5, phase 3-7.

### Why the prototype looks unpolished (what we fix)
| Problem in prototype | Fix |
| --- | --- |
| 10-11 px text everywhere, weights 850/900 | one type scale, min 12 px (labels) / 14 px (body), weights 400/500/600/700 |
| 8 different radii (7, 8, 9, 10, 11, 13, 15, 17, 20 px) | one radius scale: 6 / 10 / 14 / pill |
| ~60 hard-coded hex colours, no tokens | 3-layer token CSS (primitive -> semantic -> component) |
| Emoji and unicode glyphs as icons | one inline-SVG icon set |
| Tables use `white-space: nowrap` + horizontal scroll (11-column export table) | merged-column tables, no horizontal scroll |
| Orange text/buttons on white fail contrast (about 3:1) | darker accent for text/buttons, checked to AA 4.5:1 |
| Blue tags near violet (`#eaf0ff`) | true blue, no violet/lavender anywhere |
| Inline styles inside templates, tiny tap targets | tokens only; 44 px touch targets; focus rings |
| No empty / loading / error states | every table and page gets all three |

---

## 2. Research findings

### taste-skill (github.com/Leonxlnx/taste-skill, v2.5.1) - read only, not installed
It is built for company websites; it says nothing specific about admin screens. Rules that still apply to an app UI, and that we adopt:
- One design system: **one** spacing scale, type scale, radius scale, button pair, card style, link style. Nesting of boxes at most **two deep**.
- Tokens first: custom properties on `:root` with short prefixes; page CSS only where tokens cannot do it.
- Soft radius by default; depth from 1 px borders and surfaces, not heavy shadows.
- **No violet or lavender** in the design (accents, grounds, gradients, tints).
- Contrast must be sufficient; buttons say verb + object ("Release batch", not "OK").
- Equal left/right content edges; tap targets at least 44 px; mobile = one column, full-width buttons.
- No fade-in on scroll, no parallax, no random blinking. One hover language (cards lift 2 px, buttons step, press on click).
- No invented data: all figures in the app are the client's sample data and labelled as sample.
- Verify at 1440 / 1024 / 820 / 768 / 390 (and 320): no overflow, no collisions, no small tap targets. Fix every finding.
- It does **not** use native CSS nesting (flat rules with `:is()/:where()/:has()`); we do use nesting because you asked for it.

### Fonts (Google Fonts)
taste-skill's type library pairs fintech/data tools with: Geist / Geist Mono, Manrope / JetBrains Mono, IBM Plex Sans / IBM Plex Mono, Instrument Sans / DM Mono.
**Recommendation: Geist (headings + UI) + Geist Mono (voucher numbers, ledger figures).**
Why: sharp and quiet, true tabular numerals so amounts line up in columns, a mono twin for references, weights 400-700. Fallback stack: `system-ui, sans-serif`.
Alternative if you dislike it: Manrope + JetBrains Mono. Switching is one token (`--font-sans`).
Loading: Google Fonts `<link>` with `preconnect` + `display=swap`; Angular production build inlines the font CSS.

### Token CSS + nested CSS
- `@layer reset, tokens, base, components, utilities;` so cascade order is explicit.
- Tokens in three tiers: **primitive** (`--orange-600`, `--space-4`) -> **semantic** (`--surface-card`, `--text-muted`, `--accent`) -> **component** (`--btn-h`, `--table-row-h`, `--field-border`).
- Native CSS nesting (`&`) in every component file; components move from SCSS to plain `.css`.
- Dark theme later = remap semantic tokens only (not in scope now).
- Bootstrap is **removed** (it fights custom tokens and adds 380 KB).

### Merged-column tables (no horizontal scroll)
Each column can **merge** other fields as a muted second line, and can have a **priority**:
```
Order SO-201 / 05 Nov 2026 | Distributor / region | SKU / cartons | Invoice / due | Status | Actions
```
- Desktop (container >= 900 px): up to 6 columns; the 11-column export table becomes 6 by merging.
- Tablet (container < 900 px): priority-3 columns fold into the merged line.
- Phone (container < 640 px): each row becomes a card (label : value pairs).
- Numbers right-aligned, tabular, Geist Mono; text wraps, never `nowrap` except numbers; sticky header; one actions column (primary button + overflow menu).
- Driven by CSS **container queries**, so it also works inside narrow panels.

---

## 3. Schema: old vs new

Old (my first guess): parties, products, materials, material_issues, production_receipts, dispatches, payments, investments, expenses, ledger_entries with a fixed account enum.
**Dropped.** The client has no "materials issued to manufacturer"; the factory cost is one number per batch, accrued as a payable.

New tables (about 30), grouped:

| Group | Tables |
| --- | --- |
| Setup | `settings` (one row), `currencies`, `accounts` (chart of accounts), `categories` (income / expense / cost center + budget), `container_types`, `users` |
| Parties | `manufacturers`, `distributors`, `distributor_rates` (agreed SKU rate per distributor) |
| Products | `products` (sku, pack size, MRP, distributor rate, factory rate, packaging/printing/inbound rate, packs per carton) |
| Operations | `production_batches`, `manufacturer_payments`, `sales_orders`, `collections` |
| Finance | `finance_entries`, `accounting_documents`, `accounting_settlements`, `approvals` (signature A/B, any document) |
| Exports | `export_shipments`, `export_receipts`, `export_cost_payments` |
| Ledger | `journal_vouchers`, `journal_lines` (replaces `ledger_entries`; lines point to `accounts`) |
| Partner portal | `portal_requests`, `cargo_receipts`, `payment_advices`, `credit_notes`, `audit_log` |

Rules carried over exactly from the prototype:
- Posting (debit / credit): batch released = Inventory / Manufacturer Payable; dispatch = A/R / Sales Revenue **and** COGS / Inventory (unit cost = released cost / released cartons); collection = Cash / A/R; capital = Cash / Owner Equity or Partner Loans; approved opex = Expense / Cash; asset = Fixed Assets / Cash; accounting income/bill = A/R or Expense / A/P; export shipped = A/R / Export Sales Revenue (+ COGS, + seller logistics by Incoterm); FX gain / loss on export receipts.
- Dual signature: spend needs 1 signer below the threshold, 2 (A and B) at or above it. Unapproved spend does not touch cash.
- Stock (cartons) = released batches - dispatched orders - shipped exports.
- Invoice = cartons x packs per carton x rate per pack.
- Roles: Admin, Manufacturing, Finance, Distribution, Exports, Viewer, Distributor (+ signing seat A / B / none). Server-enforced; menu hidden by role.
- Human refs kept (B-1001, SO-201, FIN-001, RC-01 ...) as `refNo`; primary keys stay UUID.

Dummy data = the prototype's own seed, loaded 1:1: 1 manufacturer, 4 products, 3 distributors, 4 batches, 3 orders, 1 collection, 6 finance entries, 2 accounting documents, 8 users, 6 currencies, chart of accounts, 6 budgets, 3 container types, settings, 1 portal request. Exports, settlements, advices, credit notes are empty in the client's data, so they stay empty (empty states get designed).

**Parity check (the acceptance test for the data phase).** The prototype shows these on first load; our seeded API must return the same:

| Figure | Prototype |
| --- | --- |
| Cash available | PKR 1,897,000 |
| Warehouse stock | 65 cartons = 28,080 packs |
| Net profit after expenses | PKR -20,942 |
| Open receivables | PKR 55,600 |
| Capital raised / target | 2,000,000 / 8,000,000 |
| SO-201 / SO-202 / SO-203 | 29,700 / 18,900 / 21,600 |
| Alerts | 5 (2 approvals, low stock Z20-KET, draft SO-203, batch B-1004) |

---

## 4. Target structure

```
zingo_frontend/src/
  styles/        tokens.css  reset.css  base.css  utilities.css      (layers)
  app/
    ui/          icon  button  tag  card  kpi  field  modal  toast  empty-state  data-table  page-header
    forms/       form-spec.ts (one config -> modal form)  form-modal  special forms (journal, cargo receipt, export costing)
    core/        api  auth  roles  interceptor  guard
    layout/      shell (sidebar, topbar, user switch)
    features/    overview  manufacturing  finance  accounting  distribution  pricing  exports  ledger  users  settings  partner-portal
    portal.config.ts   menu + routes + role access from one list
zingo_backend/src/   one folder per feature; TxnService / posting engine rebuilt on chart-of-accounts codes
```

---

## 5. Phases (each ends with a build, browser check and a stop for your review)

**Phase 1 - Design system (frontend only)**
- 1a tokens.css, fonts, layers, reset/base; remove Bootstrap; contrast of every colour pair checked by script.
- 1b app shell (sidebar, topbar, role switch), icon set, button, tag, card, KPI, field set, modal, toast, empty/loading/error.
- 1c data-table with merged columns, container-query collapse, row actions.
- 1d a hidden `/admin/ui` specimen page; check at 1440 / 1024 / 820 / 390 / 320: zero horizontal overflow, tap targets >= 44 px, no console errors; screenshots.
- Done when: specimen page passes the checks and you approve the look.

**Phase 2 - Schema + data (backend)**
New entities, chart of accounts, posting engine, approvals, roles guard, `db:reset`, seed from the client's data. Done when: parity table above matches, ledger balances, API 401/400/409 behaviours hold.

**Phase 3 - Operations pages**: Overview, Manufacturing (SKUs, batches, release, manufacturer payments), Distribution (distributors, orders, dispatch, collections). All their forms and tables.

**Phase 4 - Money pages**: Investment & Finance (entries, approval desk, budgets, cost centers), Income & Expenses (documents, settlements, P&L, journal, cash book).

**Phase 5 - Trade pages**: Pricing & Margins (unit economics, rate cards, agreed rates), Export Containers (quotes, costing, collections, cost payments), General Ledger (trial balance, account ledger, vouchers, chart of accounts, aged receivables, cash flows).

**Phase 6 - Admin pages**: Users & Roles, Settings & Data (currencies, containers, Incoterms, categories, cost centers, manufacturers, payment cycles, assumptions, CSV export).

**Client rule (2026-11-10, Sir Mudassir, Arittek): "Make sure everything is controlled from settings."** Phase 6 is therefore the control centre, and nothing a business user may want to change stays hard-coded.
Moves into Settings & Data (database-backed, editable, used by every form and report):
- Lists: payment methods, payment cycles, currencies and exchange rates, container types and planning cartons, Incoterms (code, meaning, and which cost lines the seller carries), income / expense categories, cost centers and budgets, funding types, QC result options.
- Numbers: approval threshold, signatories, capital target, packs per carton, low-stock level, overhead per pack, sales tax rate, credit defaults, aged-receivable buckets, default container, default Incoterm, document number prefixes, fiscal year start, number locale, company name.
- Chart of accounts (already editable on the General Ledger page; also reachable here).
Stays fixed because the posting rules and permissions depend on it: roles and which page each sees, order / batch / export status flow, account types, finance entry types.
Audit to do while building it: the frontend still carries copies of `PAY_METHODS`, `QC_OPTIONS`, the Incoterm list and `ACCOUNT_TYPES` (ops/models.ts, exports/models.ts, ledger/models.ts) and the backend validates them with `@IsIn` lists in `common/enums.ts`. Each editable list gets a table and an endpoint; forms read their options from the API; DTOs validate against the table.

**Phase 7 - Distributor partner portal**: replenishment requests, my orders, cargo receipt and damage claims, payment advices, agreed rates, statement, Zingoo approval desk.

**Phase 8 - Polish and QA**: taste-skill checklist on every page at all widths, copy pass (verb + object buttons), empty/error states, keyboard and focus, final parity run.

---

## 6. Decisions I made (tell me to change any)

1. Fonts: Geist + Geist Mono.
2. Remove Bootstrap and Bootstrap Icons; inline SVG icon set (Lucide-style, ISC licence, about 40 icons).
3. Plain `.css` with native nesting in place of SCSS.
4. Old schema is dropped; dev database is reset.
5. Partner portal (distributor self-service) is built last (Phase 7), as part of the same app, role-gated.
6. Exports and FX stay in scope (the prototype has them), seeded empty as the client's data is.
7. Light theme only for now.

## 7. Questions for the client / you

1. Should the partner portal be in this release, or later?
2. Do real distributors log in themselves (needs real accounts and password reset), or is it staff-only for now?
3. Is PKR the only reporting currency, with USD/AED/EUR/GBP/CNY only for exports? (prototype says yes)

---

## 9. Platform upgrade (requested 2026-11-10)

New requirements from the client side, applied to **every** page, old and new. Phases 4-8 above are built on top of this, so
this block comes first.

### 9.1 House rules (every session, every file)

1. **Documented code.** Every file starts with a header comment (what it is, what it owns). Every exported class, function, method,
   component input/output and every CSS section has a short doc comment. A check (`npm run docs:check`) reports gaps.
2. **No assistant names anywhere** in code, comments, docs, commit messages or trailers. **No co-author lines, ever.** Author of the
   project: Mohammad Hamza, mhfrough.dev.
3. **Only the main session runs `git commit` / `git push`.** Other sessions leave their work in the working tree.
4. **Viewport units:** `dvh` / `dvw` / `svh` only, never `vh` / `vw`.
5. **z-index only from tokens** (`--z-*` in `tokens.css`). No raw numbers. A lint script checks it.
6. **Realtime, no polling.** Data on screen changes when the server says it changed (Socket.IO). No `setInterval` refresh.
7. **Compact by default.** More rows per screen, less white space, same design system (density tokens, not one-off CSS).
8. **Forms open in an off-canvas panel**, 50% of the screen width when the form is big. Closing a half-filled form asks "Discard changes?".
   Long text (notes, descriptions) is saved as a **draft** while typing and offered back later.
9. **Every table:** pagination (rows per page, page buttons, "Showing a-b of N", total pages), filters, search, sort.
   **Every dropdown** has search.
10. **Pages use tabs** instead of stacking every table under each other.
11. **Storage:** one wrapper (`AppStorage`) over localStorage, sessionStorage, cookies and IndexedDB. Nothing else touches them directly.
12. **Scroll:** reserved scrollbar gutter on the page so content never jumps between pages that scroll and pages that do not.

### 9.2 Phases, owners and files

| Phase | What | Owner | Owns (others do not edit) |
| --- | --- | --- | --- |
| U0 | Git repo, baseline commit, author metadata, `admin@zingo.pk` seed user, Pakistan place data (`public/data/pk-places.json`) | main | root files, `zingo_frontend/public/data` |
| U1 | **Design system v2**: off-canvas, tabs, searchable select, table v2 (pagination, filters, sort, footer), compact density, sidebar item without left border, z-index tokens + lint, dvh/dvw + lint, scrollbar gutter, discard dialog variant, draft banner look, connection pill in top bar, finish sign-in page (remember me, password eye), earlier motion / scroll / confirm work | `zingoo-ui` session | `src/styles/**`, `src/app/ui/**`, `src/app/layout/**`, `src/app/pages/login.*`, `src/app/pages/ui-specimen.*` |
| U2 | **Platform services**: realtime (Socket.IO gateway + commit hook + client), `AppStorage`, remember me, inactivity auto-logout (30 min default, adjustable, warning countdown, cross-tab), preferences + Settings > Preferences page, drafts (IndexedDB), unsaved-changes guard, `PlacesService`, server settings fields | `zingoo-platform` session | `src/app/core/**`, `src/app/shared/**`, `src/app/features/settings/**`, `zingo_backend/src/realtime/**`, `zingo_backend/src/setup/**`, `zingo_backend/src/auth/**` |
| U3 | **Apply**: move Overview, Manufacturing, Distribution onto off-canvas forms + drafts + discard, tabs, paginated tables, searchable selects (city from Pakistan data), live data | main | `src/app/features/{overview,manufacturing,distribution,ops}/**`, `app.routes.ts`, `portal.config.ts` |
| U4 | **Docs and repo**: README, GitHub description + topics, `docs:check` tool, then the documentation pass over all code, then push | `zingoo-docs` session (tool + README now, code pass last) | root `README.md`, `scripts/docs-check.*`, comment-only edits at the end |
| U5 | Verify: tests, lints, widths, two-browser realtime check, push | main | everything (read) |

### 9.3 Contracts between the sessions

- **Off-canvas** (U1 builds, U3 uses): `<app-offcanvas [(open)]="open" title subtitle size="md|lg|xl" [dirty]="form.dirty">` with `[offcanvasFooter]`
  slot. `md` = 32rem, `lg` = 50dvw (min 36rem), `xl` = 70dvw. Closing while `dirty()` asks `ConfirmService` "Discard changes?"
  (Keep editing / Discard). Same inputs and outputs as `Modal` where they overlap.
- **Select** (U1): `<app-select [options]="..." searchable>` works as a form control (`formControlName`, `ngModel`), search box,
  keyboard navigation, handles 500+ options (cities), shows a secondary line per option.
- **Table** (U1): `DataTable` keeps its current inputs. New optional: `tableId` (persists page size, sort, filters), `pageSizes`,
  `filters` (column filter definitions), `serverMode` + `total` + `(query)` for later server-side paging. Footer shows range, total records,
  total pages, rows-per-page.
- **Tabs** (U1): `<app-tabs [tabs]="..." [(active)]="tab">`, keeps the active tab in the URL (`?tab=`), remembered per page.
- **Storage / preferences** (U2 builds first, U1 reads): `AppStorage.get/set/remove(key, { scope: 'local' | 'session' | 'cookie' })`,
  `IdbStore` for drafts; `PreferencesService` signals `pageSize`, `density`, `autoLogoutMinutes`.
- **Drafts** (U2): `[appDraft]="key"` on a `<form [formGroup]>` saves the value (debounced) to IndexedDB and offers it back with a banner;
  `DraftStore.save/load/remove`. U1 restyles the banner.
- **Realtime** (U2): `liveResource(loader, ['sales_orders', 'collections'])` returns a resource that reloads when those tables change.
  `RealtimeService.status` signal (`connected | connecting | offline`) feeds the connection pill (U1).
- **Auth** (U2 changes `AuthService.login(email, password, remember = false)`, U1 wires the checkbox on the sign-in page).
- **Places** (U2): `PlacesService.provinces()`, `.cities(province?)` returning select options from `public/data/pk-places.json`.

### 9.4 Done when

All twelve house rules hold (lint scripts pass), Phase 3 pages use the new kit and services, two browser windows see each other's
changes within a second, an idle session is signed out after the configured time, a half-filled form can be discarded or restored,
and the README describes all of it.

---

## 10. Deployment (Render, 2026-11-11)

Everything runs on Render from `render.yaml` (a Blueprint named `zingoo`, repo `mhfrough/zingoo`, branch `main`, Singapore):

| Piece | Name | Address |
| --- | --- | --- |
| PostgreSQL | `zingo-db` | internal only |
| API (NestJS) | `zingo-api` | https://zingo-api.onrender.com/api (Swagger: `/api/docs`) |
| Web app (Angular) | `zingo-web` | https://zingo-web.onrender.com |

- The API start command first runs the seed with `DB_SYNC=true` (creates or updates the tables, loads the client's sample data only when the database is empty), then starts the API.
- Secrets live only in the Render dashboard: `SEED_PASSWORD` (sample users), `ROOT_EMAIL`, `ROOT_PASSWORD`; `JWT_SECRET` is generated.
- The repo was connected as a public URL, so Render does **not** auto-deploy on push. To release a change: push to `main`, then on the Blueprint page press **Manual sync** (approve any change it lists), then **Manual Deploy → Deploy latest commit** on the changed service. Connecting the GitHub app to the repo in Render turns auto-deploy on.
- Build uses `npm install` because Render's npm refuses these lock files with `npm ci`.
- Free plan: the database expires after 30 days and the API sleeps when idle (first request about 30 to 50 seconds).
- The web app is built with `API_URL` (see `zingo_frontend/scripts/set-env.mjs`); if Render ever gives a service another address, change `API_URL` on `zingo-web` and `CORS_ORIGIN` on `zingo-api`.
- Before real customer data: move from `DB_SYNC` to migrations, and move off the free database.

---

## 11. Scope v2: consignment chain (2026-11-12)

Sources: `instruction and plans/` (client's handwritten notes, flow chart, written instructions, voice transcript).

Flow: **Investor → Company → Manufacturer → Distributor → Customer.**

### 11.1 Client answers (2026-11-12)
1. Sale at dispatch: the user had no view; my suggestion below (11.2) applies until the client says otherwise.
2. Units: snack packet → bundle → container. **Container = batch** (the unit handed to a distributor). Today's "carton" becomes "bundle".
3. Settings gets a bank list. A manufacturer is linked to one or more banks (one default); the manufacturer picks the bank on its payment invoice and the payment goes to that bank.
4. Income on a distributor invoice = distributor rate × packets.
5. Sell-out days: default on the distributor, can be changed on the product assignment and on each shipment.
6. One manufacturer and one distributor per product for now (tables allow more later).
7. Investor returns / profit share: later, not now.
8. Departments vs cost centers: open; cost centers stay as they are.

### 11.2 What happens to the old flow
Today: staff release a batch into the **Zen Foods warehouse**; a **sales order** to a distributor is dispatched from that stock, and dispatch posts the sale at once (A/R / Sales and COGS / Inventory); the distributor then pays.
New: the manufacturer ships **straight to the distributor**; the stock stays ours (consignment) until the distributor reports a batch distributed and sends its invoice; income posts then.
Suggestion: the production order has a destination, **assigned distributor** (default) or **Zen Foods warehouse**. Warehouse stock feeds export containers only. Domestic sales orders and dispatch are retired from the menu (data kept); the distributor portal's stock requests become requests for a new order.

### 11.3 Postings
| Event | Debit | Credit |
| --- | --- | --- |
| Advance paid (after approval) | Advance to Manufacturer | Cash / Bank |
| Containers received by distributor | Inventory at Distributor | Manufacturer Payable |
| Advance applied | Manufacturer Payable | Advance to Manufacturer |
| Balance paid | Manufacturer Payable | Cash / Bank |
| Distributor invoice for a batch | A/R Distributor | Sales Revenue |
| Same | COGS | Inventory at Distributor |
| Collection | Cash / Bank | A/R Distributor |

### 11.4 Phases
| Phase | What |
| --- | --- |
| P1 Product | flavour, description, packet size, packets per bundle, bundles per container (packets per container worked out), assigned manufacturer and distributor, sell-out days |
| P2 Settings | bank list; manufacturer banks (default) and advance %; distributor area (Pakistan places) and default sell-out days |
| P3 Manufacturer portal + orders | Manufacturer role and login; production order (product, containers, rate, destination, due date); accept / reject; status steps (Accepted, Preparation, Production, QC, Ready, Shipped) from Settings; alerts to the company |
| P4 Payment requests | advance (from advance %) and balance requests raised by the manufacturer to a chosen bank; approval with signatures; pay; manufacturer position: to pay / approved / paid / remaining |
| P5 Shipment to distributor | containers (batches) shipped to the assigned distributor; receipt confirmed in the distributor portal; stock at distributor; sell-out clock starts |
| P6 Distributor sales | distributor marks a batch distributed and sends its invoice; company verifies; income and receivable post; payments against it; stock left; sell-out deadline alerts; domestic sales orders retired |
| P7 Reports + data | manufacturer and distributor statements, batch trail (sent / distributed / invoiced / collected), chain dashboard, new sample data, parity and API checks rewritten |
| P8 Leftovers | polish, realtime, income invoice steps 03-04, bill Rejected, print invoice, paused loan / advance rework, investor returns |

Status: **P1 done** (2026-11-12, 0a428eb): products with flavour, packet size, packets per bundle, bundles per container, assigned manufacturer and distributor, sell-out days; "carton" reads "bundle" on screen. **P2 done** (2026-11-12): Settings list Banks; manufacturer advance % (Settings default 30) and bank accounts (one default; a bank switched off stays on accounts that have it); distributor province, main city and other areas from `public/data/pk-places.json` (`PlacesService`). API checks 446.
**P3 done** (2026-11-12): role **Manufacturer** (a login tied to one manufacturer; sees only the Manufacturer Portal page; partner roles are closed by default in the roles guard); production orders `MO-001` (Draft -> Sent -> Accepted / Rejected, company can cancel Sent or Accepted with a reason; packaging, rate and advance % copied from the product and manufacturer; destination distributor or warehouse); production stages from the Settings list ORDER_STAGE, forward only; timeline per order (who, company or manufacturer); alerts for orders waiting, rejected or late; company order desk on Manufacturing, Manufacturer Portal page (`/admin/factory-portal`). Demo login `manufacturer@demo.local`. No ledger posting yet (advance payment is P4). API checks 489.
**P4 done** (2026-11-12): manufacturer payment requests `PR-001` (advance up to the order's advance %, or balance up to the order value; into one of the manufacturer's bank accounts, default if none picked; raised by the manufacturer or staff for it; withdrawn before any signature); approval with the same A/B signatures and threshold as other spending (approvals docType `MFR_REQUEST`); Finance rejects with a reason or pays (part payments `MPY-001`, method and company account from Settings, no future dates). A payment posts **Advance to Manufacturer (1450) / Cash & Bank**: a prepayment until delivery (P5 turns it against the payable). Position per order (value, advance, asked, approved, paid, still to pay) on Manufacturing, Investment & Finance (where Finance signs) and the Manufacturer Portal. Alerts: request waiting for signatures, approved but unpaid. API checks 527.
**P5 done** (2026-11-12): shipments `SH-001` against an accepted order (manufacturer or staff; never more than ordered; vehicle, waybill); receipt by the distributor login (or Admin / Distribution for it; warehouse deliveries by Admin / Manufacturing), fewer than sent needs a note and only what arrived counts. Receipt posts **Inventory at Distributor (1210)** (or warehouse Inventory) **/ Manufacturer Payable** at the order rate; per order, paid advances are set against the payable (**Manufacturer Payable / Advance to Manufacturer**, never more than received or paid; rewritten after every payment and receipt). Each received lot at a distributor gets a sell-by date (receipt + product sell-out days, else the distributor's). Warehouse deliveries add to warehouse stock and its average cost. An order with shipments can no longer be cancelled; orders show shipped / received and "Delivered". Screens: Ship in the Manufacturer Portal; "Deliveries & stock" tab in the distributor portal; shipments and distributor stock on Manufacturing and Distribution. Alerts: shipment to receive, sell-by date passed. API checks 561.
**P6 done** (2026-11-12): distributor sales invoices `DI-001` for containers distributed, line by received delivery (the distributor login, or Admin / Distribution for it); the containers stop counting as its stock at once (a rejected invoice gives them back). Income = packets x the distributor's agreed rate, else the product's; due after the distributor's payment days. Admin / Finance / Distribution verify (posts **Accounts Receivable / Sales Revenue** and **COGS / Inventory at Distributor** at the manufacturer's rate) or reject with a reason, then record payments `DRC-001` (**Cash & Bank / Accounts Receivable**). Receivables list includes them; payables list includes what is owed to manufacturers for goods received net of payments. Settings switch **Sales orders from the warehouse** (`salesOrdersEnabled`, default off): off hides New sales order, the sales-order desk and the portal's Request stock (earlier orders stay visible read-only). Screens: Report sales in the distributor portal (Deliveries & stock), invoice desk on Distribution. Alerts: invoice to verify, invoice overdue. API checks 595.
**P7 done** (2026-11-12): **business chain** on Overview (Investors -> Zen Foods -> Manufacturers -> Distributors -> Customers with live figures, `GET /reports/chain`); **batch trail** per delivery (shipped, received, sold, on hand, cost, sales, collected; `GET /production-shipments/trail`) on Distribution and in the distributor portal; **manufacturer statement** (goods received vs payments, running balance; `GET /mfr-payment-requests/statement`) in the Manufacturer Portal; the distributor statement now includes sales invoices and their payments; icons for the new alert kinds. **Sample data**: after the 12 prototype parity checks the seed runs one order through the whole chain (MO-003, 2 containers Z20-MAS -> Upper Sindh: advance PR-001 paid, SH-001 received, DI-001 for 1 container verified, 20,000 collected), dated back from the day of seeding so no sell-by or due date is passed, then checks the ledger again. So after `seed:fresh` the dashboard shows cash 1,894,449.60 and receivables 89,600 (prototype 55,600 + 34,000). API checks 606.
**P8 (in progress, 2026-11-12)**: bills can be **Rejected** with a reason by Finance / Admin while waiting for approval (never posts, cannot be signed, paid or changed; can be deleted); **Print** on production orders, payment requests, distributor sales invoices, income invoices and bills (one print helper `shared/print.ts`, prints through a hidden frame, so it can be saved as PDF). Browser pass on the new screens (2026-11-12): Manufacturing and Distribution now use tabs (Orders & deliveries / Manufacturer payments / Products / Warehouse & batches; Sales invoices / Deliveries & stock / Distributors / Earlier sales orders) with new-flow KPIs; the chain on Overview sizes to its own width (row of five from 70rem, stacked below); the Manufacturer Portal hides drafts and counts only undelivered orders as in production; no progress report on a delivered order; per-packet prices show paisa; leftover carton labels renamed. API checks 618. Not done in P8 and why: income invoice steps 03-04 (need the client's screens), loan / partner advance rework and investor returns (paused by the user), realtime (large; on request).
