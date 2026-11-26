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

## 12. Client feedback (2026-11-13)
| Phase | What |
| --- | --- |
| A Distributor | areas by province / district / city (most specific area counts for exclusivity), exclusive or shared rights, status Active / Hold / Temporary suspend / Terminate (Hold makes the distributor's own logins read-only) |
| B Manufacturer | payment terms (advance, credit line with a limit, on delivery, after sale) |
| C Products | packaging templates, distributors per product, grams, outbound cost, price table with total cost and margin |
| D International distributor | the client's 10-section document, split in four: D1 record + registration, D2 pricing / currency / payment plans / banking, D3 link to exports and receivables per currency, D4 compliance, portal user roles, notifications |

Status: **A-C done** (bec28af, 4f8a1ad; deployed).
**D1 done** (2026-11-13): an International / Both distributor gets an ID `INT-DST-0001` and a registration that starts as Draft. Record: legal name, website, classification (Settings list), country, registration no. / authority / expiry, tax treatment, import / food licence, account manager, sales team and channel; contacts (one primary), addresses by type (one default per type), KYC documents by type (Settings list; Registration certificate and Authorized signatory required) with file and expiry; agreement dates, renewal and notice days, version, status, signed file, MOQ, quarterly and annual targets, approved products. Same legal name in the same country twice is refused. Workflow (`/distributors/:id/registration`): Draft -> Documents submitted (mandatory fields and required KYC in date) -> Under review (Admin / Finance) -> sign-offs Sales (Admin / Distribution / Exports), Finance (Admin / Finance), Compliance (Admin) -> Approved -> Active (Admin; signed agreement uploaded and started, an approved product, licence in date). Reject (with reason) goes back to Draft and the sign-offs start again; On hold / Suspended / Archived need a reason; resuming needs an agreement still in date; Archived can be reopened as a draft. Every step is on a trail (who, role, when, why). Screen: Registration action on international distributors in Settings. Sample: Zayed Gulf Trading (draft, made-up details). API checks 681.
**D2 done** (2026-11-13): international pricing and payment terms. On the distributor: invoice currency (Settings currencies), Incoterm (Settings list INCOTERM) with named place and version, payment terms (Advance, Credit days, On shipment, On documents, Custom schedule), a payment plan of instalments (%, due on order / before shipment / on shipment / on documents / on arrival / after invoice, days after) that must make 100% (a custom schedule needs one), remittance methods (new Settings list REMITTANCE_METHOD), bank charges (sender / receiver / shared), minimum margin % (default 10), and the distributor's bank accounts (one default; SWIFT checked; changing an account's details clears its verification). Credit for an international distributor is approved only by Finance / Admin (`PUT /distributors/:id/credit`: limit, currency, expiry, block or warn; who and when kept); the form shows it read-only. Finance verifies bank accounts (`POST /distributors/:id/banks/:index/verify`). Price list (`/distributors/:id/prices`): versions per SKU and unit (pack, dozen, bundle, container from the product's packaging; pallet and metric tonne with packs per unit), currency, discount, from / to, minimum order and multiple, promotional flag; only approved SKUs; the rate and cost per pack are frozen on the version and the margin worked out; a price under the floor or a promotional one waits for Finance (approve, or reject with a reason); a new version closes the open one the day before it starts; active prices are never deleted. Exchange rates: Finance may change a rate, every change is kept with its source and who made it (`GET /currencies/:code/rates`); a currency used by a distributor or a price cannot be deleted. Screen: Credit & prices on international distributors in Settings. Sample: Zayed Gulf Trading in AED, CIF Jebel Ali, 30 / 70 plan, Z20-MAS at AED 60 a bundle. API checks 720.
**D3 done** (2026-11-13): export orders linked to international distributors. A container quote can name a distributor (`distributorId`): what the order leaves out comes from the distributor (legal name, country, named place, Incoterm, invoice currency, today's rate, payment days and plan) and its price list (the version that applies on the quote date, promotional first; `priceId` kept); the distributor is not changed. Only approved SKUs; the quantity must meet the price's minimum order and multiple. Before it ships: the distributor is Active, its agreement Signed and in date, licence and KYC documents not expired, and the credit check passes: exposure = open invoices + this order - money not applied, in the credit currency at today's rates, against the limit (0 / expired = advance only), plus overdue invoices. Block: Finance overrides per order with a reason (`POST /exports/:id/credit-override`, kept with who and when; changing quantity, rate, currency, product or distributor clears it). Warn: ships with a credit note. Shipping sets the due date (ship + payment days). Remittances `IRC-001` (`POST /distributors/:id/remittances`): amount, currency, rate, method (agreed ones only), bank reference, fees deducted, the verified bank account it came from; posts Cash & Bank + Bank Charges (new account 5150) / Customer Advances, and each part applied to an invoice is an export receipt from Customer Advances to Accounts Receivable with the FX difference; never more than an invoice's balance or the money left; what is not applied stays as the distributor's credit (`/remittances/:id/allocate` later). Account (`GET /distributors/:id/account`): credit position, per currency invoiced / collected / open / overdue / not applied / balance with PKR equivalents, aging by the Settings buckets, orders with margin, remittances and where they went, running statement. Screens: distributor picker on the container quote, Distributor account from Export Containers and Settings. Sample: EXP-001 quote for Zayed Gulf Trading from its record and price list. API checks 761. Not yet: returns, claims and credit notes (with D4).
**D4 done** (2026-11-13): food compliance, logistics, claims and the distributor portal. Market approvals per product and country (`/market-approvals`): label version, languages and artwork, allergens, product registration and expiry, certificates (new Settings list CERT_TYPE) with expiry, minimum shelf life at dispatch, restricted ingredients; entered by Exports / Distribution, approved or rejected by the Admin (compliance reviewer); an expired registration or certificate cannot be approved; a change sends it back to Pending. An order for a distributor ships only with an approved approval for its country, a batch / lot and enough shelf life left on the batch. Shipment logistics and documents (`PATCH /exports/:id/logistics`): discharge port, mode, booking, container, seal, BL / AWB, vessel, ETD / ETA, status after shipping (Loaded, Sailed, Arrived, Delivered), documents (new Settings list EXPORT_DOC_TYPE); the batch is fixed once shipped. Distributor logistics preferences (ports, final destination, mode, container, importer of record, notify party, freight confirmation, forwarder) and recall contact with SOP; activation now also needs the recall contact and a portal Owner login. Claims `CLM-001` (damage, shortage, quality, return; never more bundles than shipped) by staff or the distributor; Finance approves with a credit note `XCN-001` (Sales Returns & Allowances / Accounts Receivable at the invoice rate up to the balance, Distributor Credit Payable beyond it) or a replacement, or rejects with a reason. Portal roles on distributor logins (Owner, Sales, Finance, Warehouse, Read-only) enforced on every portal change (orders / sales reports: Owner, Sales; receipts: Owner, Warehouse; payments: Owner, Finance; claims: Owner, Sales, Warehouse; uploads: all but Read-only). International portal (Export account tab; `/portal/intl/*`): notifications (shipped, arrived, due within 7 days, overdue, claim decided, payment received, advice rejected), what it owes per currency with aging, orders with shipping status, prices, claims, payments and statement, without Zen Foods costs or margins; claims and payment advices `RA-001` with the bank proof; Finance records the remittance from an advice (marked Recorded) or rejects it. Staff alerts: claims and market approvals to decide, payment advices, export invoices overdue. Sample: Zayed portal Owner login `intl-distributor@demo.local`. API checks 811.

## 13. Notifications and cross-portal requests (2026-11-13)
Client tested the distributor portal: a request showed "pending approval" but nobody was told. Checked the code: there is no notification system (no table, no bell, no unread counts; only the D4 international portal has a list worked out on the fly). Distributor requests, payment advices and claims reach staff only on Portal > Desk. The manufacturer never sees a claim about its own goods. A short or damaged delivery from the manufacturer is only a note on the receipt, with no claim and no approval. A manufacturer dispatch is not announced to anyone.

### 13.1 Client answers (2026-11-13)
1. A faulty-goods claim is decided by whoever the goods are from: a delivery from a manufacturer -> that manufacturer; a sales order or export from Zen Foods -> the company. The company always sees it.
2. Dispatch: a notification is enough (no approval step).
3. Stock requests: company only (not the manufacturer).
4. In-app notifications only (no email or WhatsApp).

### 13.2 Who is told
| Event | Distributor | Manufacturer | Company |
| --- | --- | --- | --- |
| Stock request filed / accepted / rejected | result | - | new (Distribution, Finance, Admin) |
| Claim on a sales order or export filed / decided | result | - | new, decides |
| Claim on a manufacturer delivery filed / decided | result | new, decides | new, sees the decision |
| Payment advice filed / confirmed / rejected | result | - | new (Finance, Admin) |
| Distributor sales invoice filed / verified / rejected / paid | result | - | new (Distribution, Finance, Admin) |
| Production order sent / cancelled | - | new | - |
| Order accepted / rejected / stage changed | if the order is for it | - | yes (Manufacturing, Admin) |
| Payment request filed / signed / paid / rejected | - | result | new (Finance, Admin) |
| Shipment dispatched | new | - | yes (Manufacturing, Distribution, Admin) |
| Shipment received (complete or short) | - | yes | yes |

### 13.3 Phases
| Phase | What |
| --- | --- |
| N1 Core | `notifications` table (to a staff role, a distributor, a manufacturer or one user; kind, title, text, link, reference, read by whom); written in the same transaction as the action; `GET /notifications`, unread count, mark read, mark all read; bell with unread count in the top bar for every login (staff, distributor, manufacturer), refreshed every 30-60 s; pending-count badges on Portal desk and the Manufacturer Portal |
| N2 Events | every row of 13.2 wired; partner logins see only their own; intl portal list moved onto the same table |
| N3 Delivery claims | a short or damaged receipt from a manufacturer becomes a claim `SCL-001` (missing / damaged bundles, note, photo); the manufacturer accepts (what is owed to it drops by the claimed goods, or it sends a replacement) or rejects with a reason; Manufacturer Portal gets a Claims tab; company sees every claim and its outcome; one "Waiting on someone" inbox for staff across portals |
| N4 Dispatch notice | a shipment tells the distributor and the company (no approval) |
| N5 Checks | API checks per event and per recipient (nobody sees another partner's notices); browser pass as distributor, manufacturer and company |

Status: **N1-N5 done** (2026-11-13, not committed). Table `notifications` (audience staff roles / one distributor / one manufacturer, kind, tone, title, body, link, ref, actor, read by whom), written inside the same transaction as each action; the person who acted is never told. API `GET /notifications`, `/notifications/counts`, `/notifications/waiting`, `POST /notifications/read` (marking read works on hold and for every portal role). Bell in the top bar for every login: Updates (unread highlighted, opens the linked page) and Waiting (every open request the login can see, who it waits on, "Waiting on you" first); counts refresh every 45 s, after navigation and after any saved change. Events wired: stock requests, sales-order claims, payment advices, distributor sales invoices, production orders (sent, cancelled, accepted, rejected, stage), manufacturer payment requests (filed, withdrawn, approved, paid, rejected), shipments (dispatched, received), legacy sales-order dispatch, export containers (shipped, shipping status), export claims, remittance advices and remittances. Delivery claims `SCL-001` (Damaged / Missing / Quality bundles with photo or PDF, never more than received): raised by the distributor (Owner, Sales, Warehouse) or Admin / Distribution for it; decided by the manufacturer (or Admin / Manufacturing): Credit posts Manufacturer Payable / Inventory at Distributor and lowers the cost of later sales from that delivery, the advance set-off, the order position, the manufacturer statement and payables; Replace posts nothing; a credit is refused once the delivery is all sold. Panels: Manufacturer Portal (decide), distributor portal Deliveries & stock (raise), Manufacturing Orders & deliveries and Distribution Deliveries & stock (staff). Phone top bar hides the sample-data tag to fit the bell. API checks 861.

## 14. Order flow gaps (2026-11-16)
The user asked for the flow of every request and actor and found three gaps: a distributor request never reached the manufacturer, there was no pickup step, and a distributor could not record what it sends to its own customers.

| Gap | Built |
| --- | --- |
| Request -> manufacturer | Accepting a stock request (Portal > Desk) now places a production order `MO-` with the product's manufacturer, delivered to that distributor, and sends it at once (or "Accept as draft"). Bundles asked are rounded up to whole containers (editable); the requested date becomes the needed-by date. The request shows its order, stage and ready date. A warehouse sales order is still possible only when sales orders are switched on in Settings. |
| Ready + pickup | The manufacturer's last production stage (Settings list, default "Ready to ship") now sends "ready: collect it or wait for dispatch" to the distributor and the company. The distributor (Owner / Warehouse, or Admin / Distribution for it) can "Confirm pickup" on a ready order: a shipment with method Pickup (vehicle, collected by), on the road until it confirms receipt at its warehouse. Manufacturer and company are told. The manufacturer can still deliver the rest itself. New "Coming from the manufacturer" table on Deliveries & stock: waiting, in production, ready, with the ready date. |
| Distributor dispatch | `distributor_dispatches` `DSP-001`: bundles out of a received delivery to a customer (shop, wholesaler, sub-distributor), with area and vehicle; closed as Delivered or Returned (reason; returned bundles can go out again). Never more than arrived less claims. Zen Foods (Distribution, Admin) is told at each step; open dispatches wait on the distributor in the bell. Nothing posts: the sale is still the distributor's sales invoice. |

API checks 901 (40 new). Commit 3df5aa9, pushed and deployed to Render 2026-11-16 (api + web).

## 15. Client flow review (2026-11-16)
The client drew the flow: a distributor orders straight from the manufacturer; the manufacturer releases the goods; Zen Foods watches every order and handles all money (the distributor pays Zen Foods at its agreed SKU rates, Zen Foods pays the manufacturer on its payment request). Built:

| Item | Built |
| --- | --- |
| Direct orders | Settings "Distributor orders need Zingo approval" (`requestsNeedApproval`, default Off). Off: "Order stock" places the production order with the product's manufacturer and sends it at once; the distributor's notes go with it. A product with no manufacturer cannot be ordered (the form greys it out). The desk lists "Distributor orders with the manufacturers" to watch; "Requests to accept" shows only when the setting is On or old requests wait. A manufacturer that declines tells the distributor with the reason. |
| Money privacy | Global `PartnerViewInterceptor`: a distributor login never receives the manufacturer's rate, advance or the product's cost lines, nor Zen Foods' cost and margin (its goods are valued at its own price; claim values hidden); a manufacturer login never receives the distributor's price, Zen Foods' selling price or the distributor's credit and terms (distributor reduced to name, region, address, contact). |
| Readable tables | Rows lead with the product name and code (bold blue), the party on the second line ("Order / Distributor"), then the number with date and quantity. Every table of stored records gets "Last update" (updated time, added date) and is newest first unless the user sorts; statements, settings lists and due-date lists keep their order. |
| Locations | Province first, then its cities; district optional (no longer hides cities); GeoNames names cleaned ("Karachi West", "Khyber"). |
| Manufacturers | Same add / edit offcanvas as Settings on Manufacturing (header button + Manufacturers tab) and Overview (Admin). |
| Rich text | Every textarea is the rich-text editor; a value too long for its field with formatting is stored as plain text; tables, notices, CSV and vouchers show plain text, order notes keep formatting. |
| Overview | "Latest distributor orders" lists distributor orders with manufacturer and status. |

Later: manufacturers add their own SKUs; several manufacturers per product (on hold). Admin "Switch account" (any user, no password) already existed.
API checks 918.

## 16. Client notes (2026-11-18)
Scrambled client notes with screenshots. The user accepted every default. Each phase ends with a build, the API checks and a browser check, then a stop for review.

| Phase | Scope |
| --- | --- |
| H1 Quick UI | `app-help` "?" icon with a hover / focus popover (short, industry-standard wording; important inputs, sections and offcanvases only). Staff Manufacturer / Distributor pickers become a clear card (search, name, region / status). Portal "Invoices and balances": Paid shows paid of billed with a bar; status chip Paid (green) / Partial (amber) / Unpaid or Overdue (red); hover lists each payment. |
| H2 Order detail offcanvas | One reusable two-pane xl offcanvas: left = full order (product, packets / bundles / containers (Bora), ordered / wanted / ready by (tentative) / expected dates, transport, notes, step timeline, files, Voucher + PDF buttons), right = the action (Accept, Report progress, Collect). Left pane content follows the status. Used by the manufacturer, distributor and desk. |
| H3 Order stock v2 | One order number, several product lines; each line becomes its own production order, grouped under the order. A line picks a packaging template (default first) which fills packets per bundle, bundles per container and containers; the numbers can be changed on the order without changing the template. Planned transport (transporter, vehicle no., driver name / phone / CNIC) optional. Container type Bora / Carton per product (Settings list), shown "1 container (Bora)". "+ New SKU" opens the product offcanvas (Admin only). |
| H4 Pricing & margin | Full product offcanvas (same as Settings) instead of "Edit rates". Several manufacturers per product, each with its own rate; an order picks one (first by default). Several distributors (already stored). |
| H5 Ready to ship documents | Dispatch voucher (delivery challan / gate pass, PDF) is enabled once the step is Ready to ship; signed copy upload. The system raises the manufacturer invoice from the order with a due date; the manufacturer may attach its own copy and picks one or more of its bank accounts to print on it. |
| H6 Damage at pickup and receipt | Collect / receive forms take damage lines (kind, bundles, note, several proof files). Manufacturer Manager (new manufacturer access level) Accepts, Rejects or Holds, with a dispute thread (distributor, manufacturer, Zen Foods). Pending damage is held out of the amount due; Accepted = credit note on the distributor invoice and lower payable to the manufacturer; Rejected goes back into the amount due. Orders show amount before damage, damage, after damage and balance. Proof shows in the damage table. |
| H7 Terms + help sweep | Due date countdown ("16 of 30 days left"); Upcoming / Overdue use the amount after damage. Expected date = ready by + transit days (Settings). Help "?" on the remaining important places. |

Progress (2026-11-18):
- H1 built and checked in the browser: `app-help` (ui/help.ts; `help` input on `app-field` and `app-offcanvas`), `app-view-as` staff picker (ui/view-as.ts) on both portals, DataTable column options `valueTone` / `meter` / `tip`, portal orders carry `payments`. Sample-data badge and footer text removed; no coloured left-border stripes anywhere (user rule).
- H2 built and checked in the browser: `GET production-orders/:id/detail` (order, steps, ready, loads with transport, claims; scoped to the manufacturer / distributor login, partner money filter applies). `app-order-detail` (factory/order-detail.ts) is the left pane of `<app-offcanvas split>` (about 82% wide, stacks under the form below 1024px) on Accept order, Report progress and Collect, and the body of the read-only order view (also "View order" on Coming from the manufacturer). Ready by shows "(tentative)" until the last step.
- H3 built and checked in the browser (approval and direct paths): Order stock takes several product lines under one order number `DO-001` (`groupRef` on portal_requests and production_orders; each line is its own REQ- and MO-). A line picks a packaging template that fills packets per bundle and bundles per container (changeable for this order only, flagged "Packing changed") plus containers; `containers`, `packaging`, `packetsPerBundle`, `bundlesPerContainer` on the request carry into the MO (desk accept keeps them). Planned transport (`transport` jsonb: transporter, vehicle, driver name / phone / CNIC) on request and MO. Settings list `CONTAINER_UNIT` (Carton, Bora) and `Product.containerUnit`, shown as "2 containers (Bora)" in lists, panels, the order pane and the order voucher. Admin "New SKU" button on the form opens the product offcanvas. One desk notice per order in approval mode.
- Container unit moved onto packaging templates (user, 2026-11-18): each template says Carton or Bora; the order line takes the template's unit and can change it ("Carton / Bora" field); request and MO keep `containerUnit`; `Product.containerUnit` follows the default template.
- H4 built and checked in the browser: Pricing & Margins rows have "Edit product" (the full Settings product panel, now xl) besides "Edit rates". `Product.makers` (manufacturerId, rate, isDefault; default mirrored into manufacturerId / manufacturerRate, old products backfilled on boot). Product panel: "Default manufacturer" plus "Other manufacturers" rows with their own rate, Make default, remove. An order's rate is the picked maker's rate. Order stock lines show a Manufacturer pick when a SKU has several (`madeBy` names only on the rates API; `makers` hidden from both partner logins); `PortalRequest.manufacturerId` carries it into the MO.
- H5 built and checked in the browser: order pane "Dispatch documents": Dispatch voucher (delivery challan / gate pass DC-MO-xxx, per order or per load: route, transporter, vehicle, driver, quantities in the order's unit, no prices, three signature boxes) is disabled until the last production step (or a load left); "Upload signed copy" attaches it (`POST production-orders/:id/documents`, kinds CHALLAN / INVOICE / OTHER, stored as attachments `ORDER_<kind>`; download and remove scoped like the order detail; a distributor never sees INVOICE files). "Manufacturer invoices": the order's payment requests with due date, days left / late, paid, accounts; "Raise invoice" (Admin / Manufacturing / Manufacturer) with Advance or Balance, amount still open, due date = date + the manufacturer's credit days for a balance, several bank accounts (`banks`; `bank` = first) and an optional own invoice copy (`invoiceFileId`). A ready order without a balance invoice shows a prompt. The printed payment request lists the due date and every account.
- H6 built and checked in the browser: shared `app-damage-lines` (kind, bundles, what happened, several photos / PDFs uploaded at once) on Collect (damage at the factory gate: claims on a pickup before it arrives), Receive (now the split panel with the order on the left) and Report faulty goods (one claim per line). Claims: status Hold (`DELIVERY_CLAIM_STATUS`), Accept / Reject / Hold by the manufacturer's Owner or Manager (`portalRole` Manager added for manufacturer logins; Read-only manufacturer logins cannot change anything), a credit only once the load has arrived. Proof files are attachments `CLAIM_PROOF` (`GET delivery-claims/:id/proofs/:fileId`); the thread is `delivery_claim_notes` (`POST delivery-claims/:id/notes`, everyone else is told). Claims table shows proof count, messages, "at the factory gate", On hold; "Proof & messages" panel. Open claims (Pending / Hold) are held out of what the manufacturer can still invoice. Order pane "Before and after damage": bundles ordered / under review / accepted / good, and for staff and the manufacturer order value, credit, held, payable after damage, paid, balance.
- H7 built (builds; not yet checked in the browser): Settings "Transit days" (`transitDays`, default 2); expected date = ready date + transit days on the order pane, Coming from the manufacturer and My orders. Shared `dueCountdown` / `dueTone` ("16 of 30 days left", "Due today", "5 days late"; red when late, amber in the last 3 days) on the portal's upcoming / overdue invoices (balance after credit notes), distributor sales invoices, manufacturer payment requests (new Due column, extra accounts count) and the order pane. Help added on Settings (sell-out days, transit days, approval switch, manufacturer advance).
- Follow-ups (2026-11-18): staff partner picker remembers the last distributor / manufacturer in this browser (`shared/remember.ts`, guarded storage); approval desk "View order" opens the order panel; Accept request choice rows fixed. H1-H7 deployed 7a6da98; API checks 921/921 after reseed.

Also done 2026-11-18: credits in the page source (meta author / owner / copyright, `humans.txt`, header comments in both `main.ts`), not shown on screen.

## 17. Dispatch flow (2026-11-18, client voice notes)
Defaults accepted; unit of the dispatch table = containers (stock, invoices and postings count whole containers).

| Phase | Scope |
| --- | --- |
| J1 Quick | Hide "Design system" from the sidebar. Distributor field "Warranty (days)": information only (for a warranty claim contact the distributor within these days). Deploy the pending web fixes. |
| J2 Combined order | One order per manufacturer for a multi-product distributor order: the production orders of one DO- number and one manufacturer are listed, accepted, progressed, dispatched and received as one order (one row, one panel with a product table, one timeline). Approval desk accepts the whole order. Single-product orders behave as before. |
| J3 Ready to Dispatch | Final production step: table per product Ordered / Ready (any number, more or less than ordered) / Damaged in production (empty = none), vehicle registration, driver name, driver contact (required), transporter / bilty (optional), proof of handover (signed gate pass / delivery challan, at least one file). Buttons Create Voucher (print) and Ready to Dispatch (only on the last step): records the loading as the dispatch (distributor's truck), notifies the distributor with the voucher. The distributor's "Confirm pickup" goes away. Ready containers are what is paid for (over-production included); production damage stays at the factory. |
| J4 Distributor receipt | Same panel: table Ordered / Delivered / Damaged by manufacturer / Damaged on arrival (distributor, bundles) with evidence upload: Open dispute (H6 claims: accept / reject / hold) or Accept delivery. Sectioned layout. |
| J5 Money and checks | Payable and before/after figures follow ready containers and damage decisions; API checks; browser test end to end; deploy. |

Progress (2026-11-18): J1-J5 built, API checks 939/939 (18 new J checks), not yet checked in the browser or committed.
- J1: sidebar `hidden` flag (Design system hidden); `Distributor.warrantyDays` (form field, shown on the portal account card).
- J2: production orders of one DO- number and one manufacturer form one order: `POST production-orders/group/accept|reject|stage` (one notice per order), detail returns `lines`; orders list, incoming list, My orders, desk lists show one row per order; desk `POST portal/requests/group/accept`; direct ordering sends one notice per manufacturer.
- J3: `ProductionOrder.readyContainers / productionDamaged`, load `driverName / driverPhone / transporter / dispatchRef`; order document kind HANDOVER; `POST production-shipments/dispatch` (last step + loads on the distributor's vehicle, proof of handover required, one DC- number); Report progress turns into "Ready to dispatch" on the last step (quantities table, vehicle / driver / phone required, transporter, bilty, proof upload, Create voucher). Distributor "Confirm pickup" removed. Payable follows ready containers.
- J4: `POST production-shipments/receive-dispatch` (receives every load, damaged bundles become claims with the photos, note required for a dispute); "Receive delivery" panel (delivery facts, voucher, Ordered / Delivered / Damaged by manufacturer / Damaged on arrival, dispute with photos, Accept delivery or Receive and open dispute).
- J5: order panel shows Ready and Damaged in production; money and before/after damage on the ready containers.


## 18. Client meeting (2026-11-19, handwritten sheet + notes)
Full cleaned notes and answers: `instruction and plans/client-meeting-2026-11-19-plan.md`. Answers: company form = company fields + optional Money and approvals (Operations and Document numbers stay global); unit chain Piece -> Packet -> Bundle -> Bora / Bag / Carton, Truck / Container on top; packaging and printing fees per product; a distributor payment counts straight away (admin can reverse).

| Phase | Scope |
| --- | --- |
| K1 Settings | Company: Local / International, region, country, state, city, financial year, currency, optional two signatures / signatories / capital target. Lists: "Description" everywhere, rich text on loan lists and certificate types; loan tenure length (3, 4 ... months, custom, open); repayment frequency period (monthly, quarterly, half-yearly, yearly, every N months, agreed per loan) and the instalment count on the loan form; certificate picture; local payment methods beside international remittance methods; bank and cash accounts with kind (bank / cash counter), owner (company, investor, distributor, manufacturer) and bank details. |
| K2 Products | Piece level, truck level, rate table per unit, manufacturer vs distributor rate audit, packaging + printing formula on product and order. |
| K3 Distributor form | Section order, point of contact as its own section. |
| K4 Auto numbers | Order / product / invoice numbers prefilled, editable, duplicate check. |
| K5 Order stock | Read-only bag / truck, half load, no planned transport, compact, advance proof section. |
| K6 Distributor portal | Hide manufacturer name and advance, status renames, invoices table with Pay / Details modals, damage columns, one claim per order. |
| K7 Manufacturer portal | Report progress redesign, no production damage, counter cards, payment request on the row, one accept / proof panel, voucher modal. |
| K8 | Checks, browser test, deploy. |

Progress (2026-11-19): K1 built.
- Backend: `Company.fiscalMonth / market / region / country / state / city / currency / approvalThreshold / signatoryA / signatoryB / capitalTarget` (local forces Pakistan, currency must exist). `Lookup.notes` (text; rich lists store the HTML there and its plain start in `description`; a new column because changing the old column's type would make the schema sync drop it). List meta: LOAN_TENURE / REPAY_FREQUENCY `months`, CERT_TYPE `pictureId / pictureName` (image only, attached to the entry), BANK_ACCOUNT `kind / ownerType / ownerId / ownerName / bank / title / account / branch`. Old accounts become the company's; standard frequencies get their months. Money can only move through a company-owned account.
- Frontend: company form sections (Company, Location and money, Money and approvals optional, Status), companies table Location and Currency columns, lookup form fields per list, Settings lists layout, loan form shows "N instalments · T months ÷ every F months".

Progress (2026-11-19): K2 built.
- Packaging templates: `piecesPerPacket` (1 = the packet is the piece), `containersPerTruck`, `transportUnit` (new Settings list TRANSPORT_UNIT: Truck, Container 20 ft, Container 40 ft). The template shows "12 pieces × 6 packets × 8 bundles = 576 pieces per Bora" and "100 Bora per Truck = 4,800 packets". Orders keep these figures.
- Manufacturers and rates: one list on the product, each maker with rate + packaging + printing = total per packet (`ProductMaker.packagingFee / printingFee`). The product's own packaging / printing stay "bought by us" (separate costs). `Product.manufacturerRate` stays the default maker's base rate; costs per pack add the default maker's fees.
- Orders: `ProductionOrder.baseRate / packagingFee / printingFee` (rate = total); the order form takes the maker's base rate and shows the formula; the order panel shows "Rate + Packaging + Printing = total / packet × packets = value" per product line. Distributors never get these fields.
- Rate audit: manufacturer side prices from the chosen maker, distributor side from the agreed rate else the distributor price (unchanged, correct). The product form lists each distributor with what it pays.
- Admin orders list: Margin column (inflow at the distributor's rate, outflow = order value); `saleRate / saleValue / margin` on the staff list, hidden from manufacturers.
- Price table on the product: per piece, packet, bundle, container and truck.
- Shared styles: `.formula` (green worked-out price line) and `.info-figure` (bold green figure) in field.css.

Progress (2026-11-19): K3 built. Distributor form sections in the client's order: Distributor (name), Areas (local / international choice, areas, rights, international fields), Contact, Point of contact (own section), Contract (number, terms, uploads; point of contact moved out), then Trading terms and Status.

Progress (2026-11-19): K4 built.
- `GET refs/next/:kind` and `GET refs/check/:kind?value=&except=` for production (MO-), distOrder (DO-), product (SKU-), mfrInvoice (PR-); a distributor may ask only for distOrder, a manufacturer only for mfrInvoice. `common/ref.ts` REF_KINDS / nextNumber / refTaken / claimRef.
- A typed number is kept: production order `refNo` (also changeable on a draft), distributor order `orderNo` -> DO number, manufacturer invoice `refNo` (the invoice number is the request number). Duplicates -> 409 (letter case ignored), bad characters -> 400. An untouched suggestion that someone else took meanwhile gives way to the next free number.
- `app-ref-input` (ui/ref-input.ts): fills in the next number without making the form dirty, checks a changed number as it is typed ("Already used: type another" / "Free to use"). Used on the production order form, product SKU, the distributor's order stock form and both manufacturer invoice forms.
- Settings > Document numbers: prefixes for production orders, distributor orders, product SKU codes, manufacturer invoices.
- Not browser-checked: the distributor order form and the manufacturer invoice forms (API checks cover them).

Progress (2026-11-19): K5 built.
- Order stock form: container unit (Bag / Carton / Bora) and full load come from the packaging template, read only (chips under the line); packets per bundle and bundles per container stay editable for the order. New "Load": containers, Full truck(s) (trucks x containers per truck) or Half truck (half, rounded up) when the template has a full load.
- Planned transport removed from the form (the API still accepts it).
- Tighter line layout (product + 4 small fields per row); key figures (line quantities, totals) in bold green.
- Advance payment section: amount (with "Pay" the advance guide % of the order value when the distributor has one), method (Settings), date, reference, proof upload; method, date and proof required once an amount is entered. Stored as `PortalRequest.advance` on every line of the order, proof attached (DIST_ADVANCE), Finance notified. The order panel shows it to staff (proof download) and the distributor; never to the manufacturer (`distAdvance` hidden).
- Not booked into the books yet: it is recorded with its proof for Finance to check. Booking it as a customer advance and applying it to the invoice belongs with K6 (Pay modal).

Progress (2026-11-19): K6 built. Decision (user): order payments are held, then applied ("hold, then apply"); income still posts when the distributor reports sales.
- `DistOrderPayment` (DOP-): an advance with the order (K5, now booked) or Pay later; counts at once (Cash & Bank / Customer Advances), proof required, Finance / Admin can reverse. `DistOrderMoneyService`: per order (DO- number, or MO- of a single order) amount = received goods at the distributor's price (ordered goods while nothing arrived), paid = order payments + the order's share of payments on its sales invoices, balance, days since received / credit days. Order money is taken off the order's verified sales invoices oldest first (Customer Advances / Accounts Receivable, `DIST_ORDER_APPLY` per invoice); invoice `fromOrders` and `due` follow. An advance cannot exceed the order value. Endpoints `distributor-orders/money`, `money/:orderRef`, `pay`, `payments/:id/reverse`.
- Portal dashboard: account card and "What needs attention" removed; "Upcoming and overdue invoices" full width (Order, Status, Amount, Paid, Balance, Days 20/30 green / amber / red, Pay, Details); Recent orders full width with View (order panel). Pay modal (total, paid, balance, pay now, method, date, reference, proof); Details modal (each payment, proof, balance after; Reverse for Finance / Admin).
- A distributor never sees who makes the goods: manufacturer objects and names read "Zen Foods" (API filter and notices), price list has `orderable` instead of `manufacturerName` / `madeBy`; no maker choice on its order form. Request numbers hidden (order number only).
- Statuses: Acceptance pending, Received / Part received, Ready to deliver (local) / Ready to ship (international). "Manufacturing status" (was Coming from the manufacturer) under Deliveries, with a Quantity column.
- Receive delivery: damage on arrival in containers, bundles and pieces (whole bundles claimed, the breakdown in the claim note).
- Cargo & damage shows the faulty goods claims (they were only under Deliveries & stock); claims list one row per order and day with each product inside (order number on claims).
- Fix: the portal price list now sends pieces per packet, full load and transport unit (K5's full / half truck needs them).
- Not browser-checked: the damage columns on Receive delivery (no dispatch in transit in the local data).

Progress (2026-11-19): K7 built (frontend only).
- Manufacturer portal: counter cards Waiting for your answer, In production, Completed orders (all ready containers left the factory, or everything delivered), Payments received (still to receive), Invoices sent (amount invoiced); the Payment details card and the Advance on order card are gone. Sections are tabs: Orders, Deliveries, Faulty goods claims, Invoices & payments, Statement.
- Orders: "Payment request" on the order row once Ready to dispatch is done and something is still to ask for (opens the request with the order and the next invoice number filled in); "Print order" is now "Voucher".
- Report progress: the production steps as a stepper (done, now, pick the next); Ready to dispatch in three numbered boxes (quantities with a ready total, vehicle and driver, proof of handover); "Damaged in production" removed.
- Faulty goods claims: the decision (accept with credit / replace, hold, reject, reason) sits in the claim panel with the proof and the messages; the separate decide panel is gone; the row action is "Review and decide".
- Vouchers everywhere open in a pop-up with the voucher and Download PDF (the print dialog) / Close.
- Tabs (every page): a contained strip with a raised card that slides behind the active tab.

Progress (2026-11-19): K8 checks. Fresh reseed: all 13 parity checks pass. Full API run 1006/1006 (one old check updated: a distributor no longer sees who makes a product). API and web production builds pass (web only size warnings).

K8 done (2026-11-19): pushed main (cd32556: J1-J5 and K1-K8) and deployed on Render, zingo-api then zingo-web (Manual Deploy, latest commit; render.yaml unchanged so no Blueprint sync). Live API answers the new endpoints (refs, distributor-orders/money); live web bundle has the new screens.

## 19. Client tasks (2026-11-26)

Plan and answers: `instruction and plans/client-tasks-2026-11-26-plan.md` (L0-L8).

- L0 Delete business data: `npm run db:clear -- --yes` and Settings > Zingo > Delete business data (super admin, type DELETE). Keeps companies, Settings, lists, currencies + rates, categories / cost centers, container types, chart of accounts, staff logins, logos. Takes all locks first, retries on a deadlock. `settings.sampleDataOff` stops the seed from loading the sample again; `settings.setupDone` stops the start-up from re-making a company.
- L1 Settings > Zingo tab (first tab): platform name, logo, tagline, address, contacts (super admin edits). Shown on the sidebar, login page, browser title and voucher footer. Root account shown as Super admin. A changed ROOT_EMAIL moves the super admin to it (with ROOT_PASSWORD).
- L2 Logos on companies, manufacturers, distributors (Admin uploads ownerType logo; public GET logos/:id serves only logo images); table thumbnails.
- L3 Super admin deletes any company or all of them (next active becomes primary; none left = platform name).
- L4 Sidebar "who is signed in" card (company, distributor or manufacturer) from GET platform/identity.
- L5 Rich text on every list description, note fields, voucher memo (text column, ledger lines get plain text) and bank / transfer references (server keeps plain text via PlainRef).
- L6 Unsaved changes: browser close / reload, page change, tab change, sign out; app-modal has [dirty].
- L7 Fields: 4 per row (3 under 1100px, 2 in md panels), label / control / hint rows shared (subgrid), radius 0.375rem, button labels centred, no page scroll behind an open dialog. Every native select is now app-select with search (it reads <option> children; [value] / (valueChange) outside forms). Kept native: rows per page, Switch account.
- L8 Checks: API run 1033/1033 on a fresh seeded throwaway database (23 new L checks incl. clearing the data); browser sweep of 12 pages, 50 tabs, ~60 forms with no errors; UI flow (duplicate SKU, rich-text voucher, distributor order, manufacturer accept, discard guard). The throwaway database was dropped afterwards.
