# Zingo Distributor Portal v2 - Plan

Source: client prototype `Zingoo_v4_Distributor_Portal.html` (221 KB, one file, localStorage only).
Goal: rebuild it as the real app (Angular + NestJS + PostgreSQL) with a polished theme, every form, every table, the client's dummy data.

This plan **replaces my first guess** of the business. The client's v4 model is richer and different (see section 3).

## Status

| Phase | State |
| --- | --- |
| 1 Design system | **Done** (2026-11-10). Open `/admin/ui` after login. Production build: initial JS+CSS 89 KB gzipped (the Bootstrap build was far larger). |
| 2 Schema + data | **Done** (2026-11-10). 29 tables, double-entry posting engine, roles + seats, 42 API paths, client seed. Prototype parity: 12 of 12 checks pass; API rule smoke test: 49 of 49 (`npm run test:api`). |
| 3 - 8 | Not started |

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
