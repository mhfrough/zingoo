import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Role } from '../common/enums';
import { Lookup } from '../setup/setup.entities';
import { Distributor, DistributorRegistrationEvent, RegistrationStatus } from './catalog.entities';

/** who is acting */
export interface RegistrationUser {
  id: string;
  name: string;
  role: Role;
}

/** the three sign-offs an international distributor needs, and the roles that may give each */
export const APPROVAL_STEPS = {
  Sales: ['Admin', 'Distribution', 'Exports'],
  Finance: ['Admin', 'Finance'],
  Compliance: ['Admin'],
} as const satisfies Record<string, readonly Role[]>;
export type ApprovalStep = keyof typeof APPROVAL_STEPS;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Registration of an international distributor, following the client's spec (sections 1, 8 and the approval table):
 *   Draft -> Documents submitted -> Under review -> (Sales + Finance + Compliance sign off) Approved -> Active
 * with On hold, Suspended and Archived beside it. Each step checks what it needs, and every step is kept in
 * a trail (who, which role, when, why). Rejecting sends it back to Draft and starts the sign-offs again.
 */
@Injectable()
export class RegistrationService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** where a distributor stands: status, what is missing for the next steps, the sign-offs so far, the trail */
  async state(id: string) {
    const em = this.db.manager;
    const d = await this.load(em, id);
    const events = await em.find(DistributorRegistrationEvent, { where: { distributorId: id }, order: { createdAt: 'ASC' } });
    return {
      id: d.id, code: d.code, name: d.name, status: d.registrationStatus, market: d.market,
      missingToSubmit: await this.missingToSubmit(em, d),
      missingToActivate: this.missingToActivate(d, this.approvals(events)),
      approvals: this.approvals(events),
      agreementStatus: effectiveAgreement(d),
      events,
    };
  }

  async submit(user: RegistrationUser, id: string) {
    return this.move(user, id, ['Draft'], 'Documents submitted', 'Submitted', null, async (em, d) => {
      const missing = await this.missingToSubmit(em, d);
      if (missing.length) throw new BadRequestException(`Fill these in first: ${missing.join('; ')}.`);
    }, ['Admin', 'Distribution', 'Exports']);
  }

  async review(user: RegistrationUser, id: string) {
    return this.move(user, id, ['Documents submitted'], 'Under review', 'Review started', null, null, ['Admin', 'Finance']);
  }

  /** one sign-off; the third one approves the distributor */
  async approve(user: RegistrationUser, id: string, step: ApprovalStep, note?: string) {
    if (!APPROVAL_STEPS[step]) throw new BadRequestException('Choose Sales, Finance or Compliance.');
    if (!(APPROVAL_STEPS[step] as readonly Role[]).includes(user.role)) throw new ForbiddenException(`Your role cannot give the ${step} sign-off.`);
    await this.db.transaction(async (em) => {
      const d = await this.load(em, id);
      if (d.registrationStatus !== 'Under review') throw new BadRequestException(`${d.name} is ${d.registrationStatus.toLowerCase()}, not under review.`);
      const events = await em.find(DistributorRegistrationEvent, { where: { distributorId: id }, order: { createdAt: 'ASC' } });
      if (this.approvals(events)[step]) throw new BadRequestException(`The ${step} sign-off is already given.`);
      await this.event(em, d, user, 'Approved', step, d.registrationStatus, d.registrationStatus, note);
      const after = this.approvals(await em.find(DistributorRegistrationEvent, { where: { distributorId: id }, order: { createdAt: 'ASC' } }));
      if (after.Sales && after.Finance && after.Compliance) {
        await this.event(em, d, user, 'All sign-offs given', null, d.registrationStatus, 'Approved', null);
        d.registrationStatus = 'Approved';
        await em.save(d);
      }
    });
    // read after the commit, so the answer shows the new status
    return this.state(id);
  }

  /** back to Draft with the reason; the sign-offs start again */
  async reject(user: RegistrationUser, id: string, reason: string) {
    if (!['Admin', 'Finance', 'Distribution', 'Exports'].includes(user.role)) throw new ForbiddenException('Your role cannot reject a registration.');
    return this.move(user, id, ['Documents submitted', 'Under review', 'Approved'], 'Draft', 'Rejected', reason, null, null);
  }

  async activate(user: RegistrationUser, id: string) {
    return this.move(user, id, ['Approved'], 'Active', 'Activated', null, async (em, d) => {
      const events = await em.find(DistributorRegistrationEvent, { where: { distributorId: id }, order: { createdAt: 'ASC' } });
      const missing = this.missingToActivate(d, this.approvals(events));
      if (missing.length) throw new BadRequestException(`Before activating: ${missing.join('; ')}.`);
    }, ['Admin']);
  }

  /** On hold, Suspended, Archived, or back to Active (Resumed) */
  async setState(user: RegistrationUser, id: string, to: 'On hold' | 'Suspended' | 'Archived' | 'Active', reason?: string) {
    const roles: Role[] = ['Admin', 'Finance'];
    if (to === 'Active') {
      return this.move(user, id, ['On hold', 'Suspended'], 'Active', 'Resumed', reason ?? null, async (_em, d) => {
        const ag = effectiveAgreement(d);
        if (ag !== 'Signed') throw new BadRequestException(`The agreement is ${ag.toLowerCase()}; renew it before resuming.`);
      }, roles);
    }
    if (!reason?.trim()) throw new BadRequestException('Say why.');
    const from: RegistrationStatus[] = to === 'Archived'
      ? ['Draft', 'Documents submitted', 'Under review', 'Approved', 'Active', 'On hold', 'Suspended']
      : ['Approved', 'Active', 'On hold', 'Suspended'];
    return this.move(user, id, from.filter((s) => s !== to), to, to, reason, null, roles);
  }

  /** an archived distributor starts again as a draft */
  async reopen(user: RegistrationUser, id: string) {
    return this.move(user, id, ['Archived'], 'Draft', 'Reopened', null, null, ['Admin']);
  }

  // ───────────── checks ─────────────

  /** what the spec makes mandatory before documents can be submitted */
  private async missingToSubmit(em: EntityManager, d: Distributor): Promise<string[]> {
    const m: string[] = [];
    if (!d.legalName?.trim()) m.push('legal company name');
    if (!d.classification) m.push('distributor classification');
    if (!d.country) m.push('country');
    if (!d.registrationNo?.trim()) m.push('business registration no.');
    if (!(d.countries ?? []).length) m.push('assigned territories (countries)');
    const primary = (d.contacts ?? []).find((c) => c.isPrimary);
    if (!primary) m.push('a primary contact');
    else if (!primary.email) m.push("the primary contact's email");
    if (!(d.addresses ?? []).some((a) => a.type === 'Registered')) m.push('the registered address');
    if (!d.agreementStart) m.push('agreement start date');
    const required = (await em.find(Lookup, { where: { list: 'KYC_DOC_TYPE', active: true } })).filter((l) => l.flags?.['required']).map((l) => l.code);
    for (const t of required) {
      const doc = (d.kycDocs ?? []).find((k) => k.type === t);
      if (!doc) m.push(`KYC document: ${t}`);
      else if (doc.expiry && doc.expiry < today()) m.push(`KYC document expired: ${t}`);
    }
    return m;
  }

  /** what activation needs on top of the three sign-offs */
  private missingToActivate(d: Distributor, approvals: Partial<Record<ApprovalStep, unknown>>): string[] {
    const m: string[] = [];
    for (const s of Object.keys(APPROVAL_STEPS) as ApprovalStep[]) if (!approvals[s]) m.push(`${s} sign-off`);
    const ag = effectiveAgreement(d);
    if (ag !== 'Signed') m.push(`a signed agreement (it is ${ag.toLowerCase()})`);
    if (!d.agreementFile) m.push('the signed agreement uploaded');
    if (d.agreementStart && d.agreementStart > today()) m.push(`the agreement starts on ${d.agreementStart}`);
    if (!(d.approvedProductIds ?? []).length) m.push('at least one approved product');
    if (d.licenceExpiry && d.licenceExpiry < today()) m.push('an import / food licence that has not expired');
    return m;
  }

  /** the sign-offs of the current round (since the last submission) */
  private approvals(events: DistributorRegistrationEvent[]) {
    const last = events.map((e) => e.action).lastIndexOf('Submitted');
    const round = last >= 0 ? events.slice(last) : [];
    const out: Partial<Record<ApprovalStep, { by: string; at: Date; note: string | null }>> = {};
    // a rejection (or an archive and reopen) ends the round: the next submission starts the sign-offs again
    if (round.some((e) => e.action === 'Rejected' || e.action === 'Reopened')) return out;
    for (const e of round) if (e.action === 'Approved' && e.step) out[e.step as ApprovalStep] = { by: e.by, at: e.createdAt, note: e.note };
    return out;
  }

  // ───────────── helpers ─────────────

  private async move(
    user: RegistrationUser, id: string, from: RegistrationStatus[], to: RegistrationStatus, action: string, note: string | null,
    check: ((em: EntityManager, d: Distributor) => Promise<void>) | null, roles: Role[] | null,
  ) {
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Your role cannot take this step.');
    await this.db.transaction(async (em) => {
      const d = await this.load(em, id);
      if (d.market === 'Local') throw new BadRequestException('A local distributor needs no registration.');
      if (!from.includes(d.registrationStatus)) throw new BadRequestException(`${d.name} is ${d.registrationStatus.toLowerCase()}; this step needs ${from.join(' or ').toLowerCase()}.`);
      if (check) await check(em, d);
      await this.event(em, d, user, action, null, d.registrationStatus, to, note);
      d.registrationStatus = to;
      await em.save(d);
    });
    return this.state(id);
  }

  private async load(em: EntityManager, id: string) {
    const d = await em.findOne(Distributor, { where: { id } });
    if (!d) throw new NotFoundException('Distributor not found');
    return d;
  }

  private async event(em: EntityManager, d: Distributor, user: RegistrationUser, action: string, step: string | null, fromStatus: string, toStatus: string, note: string | null | undefined) {
    await em.save(em.create(DistributorRegistrationEvent, {
      distributorId: d.id, action, step, fromStatus, toStatus, note: note?.trim() || null, by: user.name, role: user.role,
    }));
  }
}

/** a signed agreement past its end date counts as expired */
export function effectiveAgreement(d: Pick<Distributor, 'agreementStatus' | 'agreementEnd'>) {
  return d.agreementStatus === 'Signed' && d.agreementEnd && d.agreementEnd < today() ? 'Expired' : d.agreementStatus;
}
