import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ROLE_PAGES } from '../auth/access';
import { Role } from '../common/enums';
import { Notification, NoteTone } from './notification.entity';

/** who did something (never told about it themselves) */
export interface Actor {
  id?: string | null;
  name?: string | null;
}

/** the signed-in reader */
export interface Reader {
  id: string;
  role: Role | string;
  distributorId?: string | null;
  manufacturerId?: string | null;
}

/** one audience: some staff roles (Admin always included), every login of one distributor, or of one manufacturer */
export type Audience = { staff: Role[] } | { distributorId: string | null | undefined } | { manufacturerId: string | null | undefined };

export interface Note {
  to: Audience;
  kind: string;
  title: string;
  body?: string | null;
  tone?: NoteTone;
  refNo?: string | null;
  link?: string | null;
}

/** staff groups that handle each flow */
export const TEAM = {
  /** distributor requests, claims and sales invoices */
  desk: ['Distribution', 'Finance'] as Role[],
  finance: ['Finance'] as Role[],
  manufacturing: ['Manufacturing'] as Role[],
  exports: ['Finance', 'Exports'] as Role[],
};

/** app paths the bell links to */
export const LINK = {
  portal: (tab: string) => `/admin/partner-portal?tab=${tab}`,
  desk: '/admin/partner-portal?tab=desk',
  factory: '/admin/factory-portal',
  manufacturing: (tab: string) => `/admin/manufacturing?tab=${tab}`,
  distribution: (tab: string) => `/admin/distribution?tab=${tab}`,
  finance: '/admin/finance',
  exports: '/admin/exports',
};

/** something open and who has to act on it */
export interface WaitItem {
  kind: string;
  refNo: string;
  title: string;
  party: string;
  /** who has to act: "You", "Zen Foods", or the partner's name */
  waitingOn: string;
  /** the reader is the one who has to act */
  mine: boolean;
  since: string;
  link: string | null;
  tone: NoteTone;
}

const PARTNERS = ['Distributor', 'Manufacturer'];

/** "1 container", "2 containers" */
export const plural = (count: number | string, word: string) => `${count} ${word}${Number(count) === 1 ? '' : 's'}`;

/**
 * In-app notifications. Every flow calls `send` inside its own transaction, so a notice exists exactly when the
 * action it describes was saved. `waiting` lists what is still open across both portals and who it waits on.
 */
@Injectable()
export class NotificationsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  // ───────────── writing ─────────────

  /** saves one row per note; a note without an audience (no distributor on the order, say) is skipped */
  async send(em: EntityManager, actor: Actor | null, ...notes: Note[]) {
    const rows = notes.flatMap((n): Partial<Notification>[] => {
      const base = {
        kind: n.kind, title: n.title.slice(0, 200), body: n.body ?? null, tone: n.tone ?? 'info', refNo: n.refNo ?? null,
        link: n.link ?? null, actorId: actor?.id && /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null, actorName: actor?.name ?? null,
      };
      if ('staff' in n.to) return [{ ...base, audience: 'staff' as const, targetId: null, roles: [...new Set<string>(['Admin', ...n.to.staff])] }];
      if ('distributorId' in n.to) return n.to.distributorId ? [{ ...base, audience: 'distributor' as const, targetId: n.to.distributorId, roles: null }] : [];
      return n.to.manufacturerId ? [{ ...base, audience: 'manufacturer' as const, targetId: n.to.manufacturerId, roles: null }] : [];
    });
    if (rows.length) await em.save(rows.map((r) => em.create(Notification, r)));
  }

  // ───────────── reading ─────────────

  /** the SQL condition for "rows this reader may see" with its parameters, starting at $2 ($1 = the reader's id) */
  private scope(user: Reader): { where: string; params: unknown[] } {
    if (user.role === 'Distributor') return { where: `audience = 'distributor' AND "targetId" = $2`, params: [user.distributorId ?? '00000000-0000-0000-0000-000000000000'] };
    if (user.role === 'Manufacturer') return { where: `audience = 'manufacturer' AND "targetId" = $2`, params: [user.manufacturerId ?? '00000000-0000-0000-0000-000000000000'] };
    return { where: `audience = 'staff' AND $2 = ANY(roles)`, params: [user.role] };
  }

  async list(user: Reader, limit = 40) {
    const { where, params } = this.scope(user);
    const rows: (Notification & { read: boolean })[] = await this.db.query(
      `SELECT id, kind, tone, title, body, link, "refNo", "actorName", "createdAt", ($1 = ANY("readBy")) AS read
         FROM notifications WHERE ${where} AND ("actorId" IS NULL OR "actorId" <> $1)
        ORDER BY "createdAt" DESC LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}`, [user.id, ...params]);
    return { items: rows, unread: await this.unread(user) };
  }

  async unread(user: Reader): Promise<number> {
    const { where, params } = this.scope(user);
    const [r] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE ${where} AND ("actorId" IS NULL OR "actorId" <> $1) AND NOT ($1 = ANY("readBy"))`, [user.id, ...params]);
    return Number(r.n);
  }

  /** marks the given rows (or every row the reader can see) as read by this login */
  async markRead(user: Reader, ids?: string[]) {
    const { where, params } = this.scope(user);
    const only = ids?.length ? ` AND id = ANY($${params.length + 2}::uuid[])` : '';
    await this.db.query(
      `UPDATE notifications SET "readBy" = array_append("readBy", $1::uuid)
        WHERE ${where}${only} AND NOT ($1 = ANY("readBy"))`, [user.id, ...params, ...(ids?.length ? [ids] : [])]);
    return { unread: await this.unread(user) };
  }

  /** the badge: unread notices and open items the reader has to act on */
  async counts(user: Reader) {
    const [unread, waiting] = await Promise.all([this.unread(user), this.waiting(user)]);
    return { unread, waiting: waiting.filter((w) => w.mine).length };
  }

  // ───────────── what is open, and on whom ─────────────

  async waiting(user: Reader): Promise<WaitItem[]> {
    if (user.role === 'Distributor') return user.distributorId ? this.waitingForDistributor(user.distributorId) : [];
    if (user.role === 'Manufacturer') return user.manufacturerId ? this.waitingForManufacturer(user.manufacturerId) : [];
    if (PARTNERS.includes(user.role)) return [];
    return this.waitingForStaff(user.role as Role);
  }

  /** the first of these pages the role can open */
  private linkFor(role: Role, options: [page: string, path: string][]): string | null {
    const pages = ROLE_PAGES[role] ?? [];
    return options.find(([p]) => pages.includes(p))?.[1] ?? null;
  }

  private async waitingForStaff(role: Role): Promise<WaitItem[]> {
    const q = (sql: string) => this.db.query(sql) as Promise<any[]>;
    const zen = 'Zen Foods';
    const desk = ['Admin', 'Distribution', 'Finance'].includes(role);
    const fin = ['Admin', 'Finance'].includes(role);
    const mfg = ['Admin', 'Manufacturing'].includes(role);
    const link = (o: [string, string][]) => this.linkFor(role, o);
    const [reqs, advices, claims, dclaims, invoices, orders, payReqs, transit, xclaims, radvices] = await Promise.all([
      q(`SELECT r."refNo", r.date::text AS since, r.cartons, d.name AS party, p.sku FROM portal_requests r
           JOIN distributors d ON d.id = r."distributorId" JOIN products p ON p.id = r."productId" WHERE r.status = 'Requested'`),
      q(`SELECT a."refNo", a.date::text AS since, a.amount::float8 AS amount, d.name AS party FROM payment_advices a
           JOIN distributors d ON d.id = a."distributorId" WHERE a.status = 'Submitted'`),
      q(`SELECT c."refNo", c.date::text AS since, d.name AS party, c."damagedCartons" + c."missingCartons" AS n FROM cargo_receipts c
           JOIN sales_orders o ON o.id = c."orderId" JOIN distributors d ON d.id = o."distributorId" WHERE c.status = 'Disputed'`),
      q(`SELECT c."refNo", c.date::text AS since, d.name AS party, m.name AS mfr, c.bundles, s."refNo" AS lot FROM delivery_claims c
           JOIN distributors d ON d.id = c."distributorId" JOIN manufacturers m ON m.id = c."manufacturerId"
           JOIN production_shipments s ON s.id = c."shipmentId" WHERE c.status = 'Pending'`),
      q(`SELECT i."refNo", i.date::text AS since, i.amount::float8 AS amount, d.name AS party FROM distributor_invoices i
           JOIN distributors d ON d.id = i."distributorId" WHERE i.status = 'Submitted'`),
      q(`SELECT o."refNo", o."updatedAt"::date::text AS since, m.name AS party, o.containers FROM production_orders o
           JOIN manufacturers m ON m.id = o."manufacturerId" WHERE o.status = 'Sent'`),
      q(`SELECT r."refNo", r.date::text AS since, r.kind, r.amount::float8 AS amount, m.name AS party,
                COALESCE((SELECT SUM(p.amount) FROM mfr_request_payments p WHERE p."requestId" = r.id), 0)::float8 AS paid
           FROM mfr_payment_requests r JOIN manufacturers m ON m.id = r."manufacturerId" WHERE r.status = 'Submitted'`),
      q(`SELECT s."refNo", s."shipDate"::text AS since, s.containers, s.destination, d.name AS party, m.name AS mfr FROM production_shipments s
           JOIN manufacturers m ON m.id = s."manufacturerId" LEFT JOIN distributors d ON d.id = s."distributorId" WHERE s.status = 'In transit'`),
      q(`SELECT c."refNo", c.date::text AS since, c.kind, d.name AS party FROM export_claims c
           JOIN distributors d ON d.id = c."distributorId" WHERE c.status = 'Submitted'`),
      q(`SELECT a."refNo", a.date::text AS since, a.currency, a.amount::float8 AS amount, d.name AS party FROM remittance_advices a
           JOIN distributors d ON d.id = a."distributorId" WHERE a.status = 'Submitted'`),
    ]);
    const portalDesk: [string, string][] = [['portal', LINK.desk]];
    return [
      ...reqs.map((r): WaitItem => ({ kind: 'Stock request', refNo: r.refNo, title: `${plural(r.cartons, 'bundle')} of ${r.sku}`, party: r.party, waitingOn: zen, mine: desk, since: r.since, link: link(portalDesk), tone: 'warning' })),
      ...advices.map((r): WaitItem => ({ kind: 'Payment advice', refNo: r.refNo, title: `PKR ${fmt(r.amount)} reported paid`, party: r.party, waitingOn: `${zen} Finance`, mine: fin, since: r.since, link: link(portalDesk), tone: 'warning' })),
      ...claims.map((r): WaitItem => ({ kind: 'Damage claim', refNo: r.refNo, title: `${plural(r.n, 'bundle')} damaged or missing`, party: r.party, waitingOn: zen, mine: desk, since: r.since, link: link(portalDesk), tone: 'danger' })),
      ...dclaims.map((r): WaitItem => ({
        kind: 'Delivery claim', refNo: r.refNo, title: `${plural(r.bundles, 'faulty bundle')} on ${r.lot}`, party: r.party, waitingOn: r.mfr, mine: false, since: r.since,
        link: link([['manufacturing', LINK.manufacturing('orders')], ['distribution', LINK.distribution('stock')]]), tone: 'danger',
      })),
      ...invoices.map((r): WaitItem => ({
        kind: 'Sales invoice', refNo: r.refNo, title: `PKR ${fmt(r.amount)} to verify`, party: r.party, waitingOn: zen, mine: desk, since: r.since,
        link: link([['distribution', LINK.distribution('sales')]]), tone: 'warning',
      })),
      ...orders.map((r): WaitItem => ({
        kind: 'Production order', refNo: r.refNo, title: `${plural(r.containers, 'container')} to accept or reject`, party: r.party, waitingOn: r.party, mine: false, since: r.since,
        link: link([['manufacturing', LINK.manufacturing('orders')], ['factory', LINK.factory]]), tone: 'info',
      })),
      ...payReqs.filter((r) => r.amount - r.paid > 0.004).map((r): WaitItem => ({
        kind: 'Payment request', refNo: r.refNo, title: `${r.kind} PKR ${fmt(r.amount - r.paid)} to approve and pay`, party: r.party, waitingOn: `${zen} Finance`, mine: fin, since: r.since,
        link: link([['finance', LINK.finance], ['manufacturing', LINK.manufacturing('payments')]]), tone: 'warning',
      })),
      ...transit.map((r): WaitItem => {
        const warehouse = r.destination === 'Warehouse';
        return {
          kind: 'Delivery in transit', refNo: r.refNo, title: `${plural(r.containers, 'container')} from ${r.mfr}`, party: warehouse ? 'Warehouse' : r.party,
          waitingOn: warehouse ? zen : r.party, mine: warehouse && mfg, since: r.since,
          link: link([['distribution', LINK.distribution('stock')], ['manufacturing', LINK.manufacturing('orders')]]), tone: 'info',
        };
      }),
      ...xclaims.map((r): WaitItem => ({ kind: 'Export claim', refNo: r.refNo, title: `${r.kind} claim to decide`, party: r.party, waitingOn: `${zen} Finance`, mine: fin, since: r.since, link: link([['exports', LINK.exports]]), tone: 'danger' })),
      ...radvices.map((r): WaitItem => ({ kind: 'Remittance advice', refNo: r.refNo, title: `${r.currency} ${fmt(r.amount)} reported paid`, party: r.party, waitingOn: `${zen} Finance`, mine: fin, since: r.since, link: link([['exports', LINK.exports]]), tone: 'warning' })),
    ].sort(bySince);
  }

  private async waitingForDistributor(id: string): Promise<WaitItem[]> {
    const q = (sql: string) => this.db.query(sql, [id]) as Promise<any[]>;
    const zen = 'Zen Foods';
    const [reqs, advices, claims, dclaims, invoices, transit, xclaims, radvices] = await Promise.all([
      q(`SELECT r."refNo", r.date::text AS since, r.cartons, p.sku FROM portal_requests r JOIN products p ON p.id = r."productId" WHERE r.status = 'Requested' AND r."distributorId" = $1`),
      q(`SELECT "refNo", date::text AS since, amount::float8 AS amount FROM payment_advices WHERE status = 'Submitted' AND "distributorId" = $1`),
      q(`SELECT c."refNo", c.date::text AS since, c."damagedCartons" + c."missingCartons" AS n FROM cargo_receipts c JOIN sales_orders o ON o.id = c."orderId" WHERE c.status = 'Disputed' AND o."distributorId" = $1`),
      q(`SELECT c."refNo", c.date::text AS since, c.bundles, m.name AS mfr, s."refNo" AS lot FROM delivery_claims c JOIN manufacturers m ON m.id = c."manufacturerId"
           JOIN production_shipments s ON s.id = c."shipmentId" WHERE c.status = 'Pending' AND c."distributorId" = $1`),
      q(`SELECT "refNo", date::text AS since, amount::float8 AS amount FROM distributor_invoices WHERE status = 'Submitted' AND "distributorId" = $1`),
      q(`SELECT s."refNo", s."shipDate"::text AS since, s.containers, m.name AS mfr FROM production_shipments s JOIN manufacturers m ON m.id = s."manufacturerId"
           WHERE s.status = 'In transit' AND s."distributorId" = $1`),
      q(`SELECT "refNo", date::text AS since, kind FROM export_claims WHERE status = 'Submitted' AND "distributorId" = $1`),
      q(`SELECT "refNo", date::text AS since, currency, amount::float8 AS amount FROM remittance_advices WHERE status = 'Submitted' AND "distributorId" = $1`),
    ]);
    const you = 'You';
    return [
      ...transit.map((r): WaitItem => ({ kind: 'Delivery to receive', refNo: r.refNo, title: `${plural(r.containers, 'container')} from ${r.mfr}`, party: r.mfr, waitingOn: you, mine: true, since: r.since, link: LINK.portal('stock'), tone: 'warning' })),
      ...reqs.map((r): WaitItem => ({ kind: 'Stock request', refNo: r.refNo, title: `${plural(r.cartons, 'bundle')} of ${r.sku}`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('orders'), tone: 'info' })),
      ...advices.map((r): WaitItem => ({ kind: 'Payment advice', refNo: r.refNo, title: `PKR ${fmt(r.amount)} reported paid`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('payments'), tone: 'info' })),
      ...claims.map((r): WaitItem => ({ kind: 'Damage claim', refNo: r.refNo, title: `${plural(r.n, 'bundle')} damaged or missing`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('cargo'), tone: 'info' })),
      ...dclaims.map((r): WaitItem => ({ kind: 'Delivery claim', refNo: r.refNo, title: `${plural(r.bundles, 'faulty bundle')} on ${r.lot}`, party: r.mfr, waitingOn: r.mfr, mine: false, since: r.since, link: LINK.portal('stock'), tone: 'info' })),
      ...invoices.map((r): WaitItem => ({ kind: 'Sales invoice', refNo: r.refNo, title: `PKR ${fmt(r.amount)} to be verified`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('stock'), tone: 'info' })),
      ...xclaims.map((r): WaitItem => ({ kind: 'Export claim', refNo: r.refNo, title: `${r.kind} claim`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('intl'), tone: 'info' })),
      ...radvices.map((r): WaitItem => ({ kind: 'Remittance advice', refNo: r.refNo, title: `${r.currency} ${fmt(r.amount)} reported paid`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.portal('intl'), tone: 'info' })),
    ].sort(bySince);
  }

  private async waitingForManufacturer(id: string): Promise<WaitItem[]> {
    const q = (sql: string) => this.db.query(sql, [id]) as Promise<any[]>;
    const zen = 'Zen Foods';
    const [orders, dclaims, payReqs, transit] = await Promise.all([
      q(`SELECT "refNo", "updatedAt"::date::text AS since, containers FROM production_orders WHERE status = 'Sent' AND "manufacturerId" = $1`),
      q(`SELECT c."refNo", c.date::text AS since, c.bundles, d.name AS party, s."refNo" AS lot FROM delivery_claims c JOIN distributors d ON d.id = c."distributorId"
           JOIN production_shipments s ON s.id = c."shipmentId" WHERE c.status = 'Pending' AND c."manufacturerId" = $1`),
      q(`SELECT r."refNo", r.date::text AS since, r.kind, r.amount::float8 AS amount,
                COALESCE((SELECT SUM(p.amount) FROM mfr_request_payments p WHERE p."requestId" = r.id), 0)::float8 AS paid
           FROM mfr_payment_requests r WHERE r.status = 'Submitted' AND r."manufacturerId" = $1`),
      q(`SELECT s."refNo", s."shipDate"::text AS since, s.containers, s.destination, d.name AS party FROM production_shipments s
           LEFT JOIN distributors d ON d.id = s."distributorId" WHERE s.status = 'In transit' AND s."manufacturerId" = $1`),
    ]);
    const you = 'You';
    return [
      ...orders.map((r): WaitItem => ({ kind: 'Production order', refNo: r.refNo, title: `${plural(r.containers, 'container')} to accept or reject`, party: zen, waitingOn: you, mine: true, since: r.since, link: LINK.factory, tone: 'warning' })),
      ...dclaims.map((r): WaitItem => ({ kind: 'Delivery claim', refNo: r.refNo, title: `${plural(r.bundles, 'faulty bundle')} on ${r.lot}`, party: r.party, waitingOn: you, mine: true, since: r.since, link: LINK.factory, tone: 'danger' })),
      ...payReqs.filter((r) => r.amount - r.paid > 0.004).map((r): WaitItem => ({ kind: 'Payment request', refNo: r.refNo, title: `${r.kind} PKR ${fmt(r.amount - r.paid)}`, party: zen, waitingOn: zen, mine: false, since: r.since, link: LINK.factory, tone: 'info' })),
      ...transit.map((r): WaitItem => {
        const to = r.destination === 'Warehouse' ? zen : r.party;
        return { kind: 'Delivery in transit', refNo: r.refNo, title: `${plural(r.containers, 'container')} to ${to}`, party: to, waitingOn: to, mine: false, since: r.since, link: LINK.factory, tone: 'info' };
      }),
    ].sort(bySince);
  }
}

const bySince = (a: WaitItem, b: WaitItem) => Number(b.mine) - Number(a.mine) || a.since.localeCompare(b.since) || a.refNo.localeCompare(b.refNo);
const fmt = (n: number) => Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
