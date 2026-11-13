import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not } from 'typeorm';
import { Product } from '../catalog/catalog.entities';
import { round2 } from '../common/numeric.transformer';
import { nextRef } from '../common/ref';
import { AttachmentsService } from '../attachments/attachments.service';
import { PostingService } from '../ledger/posting.service';
import { Lookup } from '../setup/setup.entities';
import { ClaimDecisionDto, ClaimDto, LogisticsDto, MarketApprovalDto } from './exports.dto';
import { ExportClaim, ExportShipment, ProductMarketApproval } from './exports.entities';
import { ActingUser, ExportsService } from './exports.service';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Food compliance, logistics and claims for export shipments (spec sections 5 and 6): market approvals per product
 * and country, the checks before an order for a distributor ships (approval, registration, certificates, batch and
 * shelf life), the shipment's actual logistics and documents, and damage / shortage / quality / return claims.
 */
@Injectable()
export class ComplianceService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly exports: ExportsService,
    private readonly posting: PostingService,
    private readonly files: AttachmentsService,
  ) {}

  // ───────────── market approvals ─────────────

  approvals(productId?: string) {
    return this.db.manager.find(ProductMarketApproval, {
      where: productId ? { productId } : {}, relations: { product: true }, order: { country: 'ASC', createdAt: 'DESC' },
    });
  }

  async createApproval(user: ActingUser, dto: MarketApprovalDto) {
    const em = this.db.manager;
    if (!(await em.findOne(Product, { where: { id: dto.productId } }))) throw new NotFoundException('Product not found');
    await this.checkCerts(em, dto.certificates);
    const open = await em.findOne(ProductMarketApproval, { where: { productId: dto.productId, country: dto.country, status: Not('Rejected') } });
    if (open) throw new ConflictException(`This product already has a ${open.status.toLowerCase()} approval for ${dto.country}. Change that one.`);
    const row = await em.save(em.create(ProductMarketApproval, { ...dto, country: dto.country.trim(), status: 'Pending', createdBy: user.name }));
    await this.link(row);
    return row;
  }

  /** a change sends an approved market back for review (no silent overwrite) */
  async updateApproval(user: ActingUser, id: string, dto: Partial<MarketApprovalDto>) {
    const em = this.db.manager;
    const row = await em.findOne(ProductMarketApproval, { where: { id } });
    if (!row) throw new NotFoundException('Market approval not found');
    await this.checkCerts(em, dto.certificates);
    const { productId: _p, country: _c, ...rest } = dto;
    Object.assign(row, rest, { status: 'Pending', reviewedBy: null, reviewedAt: null, reviewNote: `Changed by ${user.name}; to review again` });
    await em.save(row);
    await this.link(row);
    return row;
  }

  /** the compliance reviewer (Admin) approves or rejects; someone else must have entered it */
  async reviewApproval(user: ActingUser, id: string, decision: 'Approve' | 'Reject', note?: string) {
    const em = this.db.manager;
    const row = await em.findOne(ProductMarketApproval, { where: { id } });
    if (!row) throw new NotFoundException('Market approval not found');
    if (row.status !== 'Pending') throw new BadRequestException(`This approval is ${row.status.toLowerCase()}, not waiting for review.`);
    if (decision === 'Reject' && !note?.trim()) throw new BadRequestException('Say why it is rejected.');
    if (decision === 'Approve') {
      const t = today();
      if (row.registrationExpiry && row.registrationExpiry < t) throw new BadRequestException('The product registration has expired.');
      const lapsed = (row.certificates ?? []).filter((c) => c.expiry && c.expiry < t).map((c) => c.type);
      if (lapsed.length) throw new BadRequestException(`Expired certificates: ${lapsed.join(', ')}.`);
    }
    Object.assign(row, { status: decision === 'Approve' ? 'Approved' : 'Rejected', reviewedBy: user.name, reviewedAt: new Date(), reviewNote: note?.trim() || null });
    return em.save(row);
  }

  // ───────────── logistics ─────────────

  /** the shipment's actual details and documents; editable after it ships too */
  async logistics(id: string, dto: LogisticsDto) {
    const em = this.db.manager;
    const x = await em.findOne(ExportShipment, { where: { id } });
    if (!x) throw new NotFoundException('Container not found');
    if (dto.documents) {
      const known = new Set((await em.find(Lookup, { where: { list: 'EXPORT_DOC_TYPE' } })).map((l) => l.code));
      for (const d of dto.documents) if (!known.has(d.type)) throw new BadRequestException(`"${d.type}" is not an export document type. Add it in Settings & Data.`);
    }
    if (dto.shippingStatus && x.status !== 'Shipped') throw new BadRequestException('Ship the container before tracking it.');
    if (dto.etd && dto.eta && dto.eta < dto.etd) throw new BadRequestException('The arrival is before the departure.');
    if (dto.mfgDate && dto.expiryDate && dto.expiryDate <= dto.mfgDate) throw new BadRequestException('The batch expires before it was made.');
    if (x.status === 'Shipped' && (dto.batchRef !== undefined || dto.mfgDate !== undefined || dto.expiryDate !== undefined)) {
      throw new BadRequestException('The batch of a shipped container is part of its record and cannot change.');
    }
    Object.assign(x, dto);
    await em.save(x);
    for (const d of x.documents ?? []) await this.files.attach(d.file.id, 'EXPORT', x.id);
    return this.exports.findOne(id);
  }

  // ───────────── claims ─────────────

  claims(shipmentId?: string, distributorId?: string) {
    return this.db.manager.find(ExportClaim, {
      where: { ...(shipmentId ? { shipmentId } : {}), ...(distributorId ? { distributorId } : {}) },
      relations: { shipment: true }, order: { date: 'DESC', refNo: 'DESC' },
    });
  }

  /** raised by staff or by the distributor on its own shipped container */
  async raise(user: ActingUser & { distributorId?: string | null }, shipmentId: string, dto: ClaimDto) {
    return this.db.transaction(async (em) => {
      const x = await em.findOne(ExportShipment, { where: { id: shipmentId } });
      if (!x) throw new NotFoundException('Container not found');
      if (user.role === 'Distributor' && x.distributorId !== user.distributorId) throw new ForbiddenException('This is not your shipment.');
      if (x.status !== 'Shipped') throw new BadRequestException('A claim is on a shipped container.');
      if (dto.date < (x.shipDate ?? x.date)) throw new BadRequestException('The claim is dated before the container shipped.');
      const [{ q }] = await em.query(`SELECT COALESCE(SUM(quantity), 0)::int AS q FROM export_claims WHERE "shipmentId" = $1 AND status <> 'Rejected'`, [x.id]);
      if (Number(q) + dto.quantity > x.cartons) throw new BadRequestException(`Only ${x.cartons - Number(q)} bundle(s) of ${x.refNo} are left to claim.`);
      const row = await em.save(em.create(ExportClaim, {
        refNo: await nextRef(em, ExportClaim, 'CLM', 3), date: dto.date, shipmentId: x.id, distributorId: x.distributorId, kind: dto.kind,
        quantity: dto.quantity, batchRef: dto.batchRef?.trim() || x.batchRef, description: dto.description.trim(), photos: dto.photos ?? [],
        raisedBy: user.name, status: 'Submitted',
      }));
      for (const p of row.photos) await this.files.attach(p.id, 'EXPORT_CLAIM', row.id, em);
      return row;
    });
  }

  /**
   * Finance decides. A credit note lowers the invoice balance (Sales Returns & Allowances / Accounts Receivable at
   * the invoice rate); a credit beyond the balance is owed back (Distributor Credit Payable), never a negative receivable.
   */
  async decide(user: ActingUser, id: string, dto: ClaimDecisionDto) {
    return this.db.transaction(async (em) => {
      const c = await em.findOne(ExportClaim, { where: { id } });
      if (!c) throw new NotFoundException('Claim not found');
      if (c.status !== 'Submitted') throw new BadRequestException(`This claim is already ${c.status.toLowerCase()}.`);
      if (dto.decision === 'Reject') {
        if (!dto.note?.trim()) throw new BadRequestException('Say why the claim is rejected.');
        Object.assign(c, { status: 'Rejected', inspection: dto.inspection?.trim() || null, decidedBy: user.name, decidedAt: new Date(), decisionNote: dto.note.trim() });
        return em.save(c);
      }
      if (!dto.resolution) throw new BadRequestException('Choose a credit note or a replacement.');
      const x = await this.exports.findOne(c.shipmentId, em);
      let credit = 0;
      let applied = 0;
      if (dto.resolution === 'Credit note') {
        credit = round2(dto.creditAmount ?? 0);
        if (credit <= 0) throw new BadRequestException('Enter the credit amount.');
        const max = round2((x.revenueForeign * c.quantity) / x.cartons);
        if (credit > max + 0.005) throw new BadRequestException(`The credit cannot be more than the claimed bundles are worth: ${x.currency} ${max}.`);
        applied = round2(Math.min(credit, x.due));
      }
      Object.assign(c, {
        status: 'Approved', resolution: dto.resolution, creditAmount: credit, creditApplied: applied,
        creditNoteRef: credit > 0 ? await this.nextCreditNote(em) : null,
        inspection: dto.inspection?.trim() || null, decidedBy: user.name, decidedAt: new Date(), decisionNote: dto.note?.trim() || null,
      });
      await em.save(c);
      await this.posting.syncExportClaim(em, c.id);
      return c;
    });
  }

  /** XCN-001: export credit notes have their own numbers */
  private async nextCreditNote(em: EntityManager) {
    const [r] = await em.query(`SELECT MAX(CAST(SUBSTRING("creditNoteRef" FROM '([0-9]+)$') AS INT)) AS n FROM export_claims WHERE "creditNoteRef" LIKE 'XCN-%'`);
    return `XCN-${String((Number(r?.n) || 0) + 1).padStart(3, '0')}`;
  }

  private async checkCerts(em: EntityManager, certs?: { type: string }[]) {
    if (!certs?.length) return;
    const known = new Set((await em.find(Lookup, { where: { list: 'CERT_TYPE' } })).map((l) => l.code));
    for (const c of certs) if (!known.has(c.type)) throw new BadRequestException(`"${c.type}" is not a certificate type. Add it in Settings & Data.`);
  }

  private async link(row: ProductMarketApproval) {
    const ids = [...(row.labelFile ? [row.labelFile.id] : []), ...(row.certificates ?? []).map((c) => c.file.id)];
    for (const id of ids) await this.files.attach(id, 'MARKET_APPROVAL', row.id);
  }
}
