import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { Distributor, Manufacturer } from '../catalog/catalog.entities';
import { ROLES, Role } from '../common/enums';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { ROLE_PAGES } from './access';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly db: DataSource,
  ) {}

  private profile(u: User) {
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, seat: u.seat,
      distributorId: u.distributorId, manufacturerId: u.manufacturerId, portalRole: u.role === 'Distributor' ? u.portalRole : undefined, isRoot: u.isRoot, pages: ROLE_PAGES[u.role],
    };
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    const ok = user && (await bcrypt.compare(password, user.password));
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');
    if (user.status !== 'Active') throw new UnauthorizedException('This account is disabled');
    if ((await this.users.distributorStanding(user)) === 'suspended') throw new UnauthorizedException('This distributor account is suspended. Contact Zen Foods.');

    return {
      access_token: this.jwt.sign({ sub: user.id }),
      token_type: 'Bearer',
      user: this.profile(user),
    };
  }

  /** the active logins an Admin can switch to, and every role (a role with no login yet can get one) */
  async viewAsOptions() {
    const users = (await this.users.list())
      .filter((u: any) => u.status === 'Active')
      .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, distributorName: u.distributorName ?? null, manufacturerName: u.manufacturerName ?? null }));
    return { users, roles: [...ROLES] };
  }

  /**
   * An Admin switches to another login (a distributor, an investor, a finance user ...) without signing in again.
   * It is that account's real session; the Admin's own session is kept by the browser to switch back.
   */
  async viewAs(adminId: string, userId: string) {
    if (adminId === userId) throw new BadRequestException('This is already your own account.');
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'Active') throw new BadRequestException('This login is not active.');
    return {
      access_token: this.jwt.sign({ sub: user.id, viewer: adminId }),
      token_type: 'Bearer',
      user: { ...this.profile(user), viewAs: true },
    };
  }

  /** switch to the first active login of a role; a role with none gets a demo login made for it */
  async switchToRole(adminId: string, role: Role) {
    if (!ROLES.includes(role)) throw new BadRequestException('Unknown role.');
    const existing = (await this.users.list()).find((u: any) => u.role === role && u.status === 'Active' && u.id !== adminId);
    if (existing) return this.viewAs(adminId, existing.id);
    let distributorId: string | null = null;
    if (role === 'Distributor') {
      const d = await this.db.getRepository(Distributor).findOne({ where: {}, order: { name: 'ASC' } });
      if (!d) throw new BadRequestException('Add a distributor first.');
      distributorId = d.id;
    }
    let manufacturerId: string | null = null;
    if (role === 'Manufacturer') {
      const m = await this.db.getRepository(Manufacturer).findOne({ where: {}, order: { name: 'ASC' } });
      if (!m) throw new BadRequestException('Add a manufacturer first.');
      manufacturerId = m.id;
    }
    const slug = role.toLowerCase();
    let email = `${slug}@zingoo.local`;
    for (let n = 2; await this.users.findByEmail(email); n++) email = `${slug}${n}@zingoo.local`;
    const user = await this.users.createUser({
      email, name: `${role} (Demo)`, role, distributorId, manufacturerId,
      password: randomBytes(18).toString('base64url'), // nobody signs in with it; the Admin switches in, or resets it on Users
    });
    return this.viewAs(adminId, user.id);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.profile(user);
  }
}
