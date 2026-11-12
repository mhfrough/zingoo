import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
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
  ) {}

  private profile(u: User) {
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, seat: u.seat,
      distributorId: u.distributorId, isRoot: u.isRoot, pages: ROLE_PAGES[u.role],
    };
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    const ok = user && (await bcrypt.compare(password, user.password));
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');
    if (user.status !== 'Active') throw new UnauthorizedException('This account is disabled');

    return {
      access_token: this.jwt.sign({ sub: user.id }),
      token_type: 'Bearer',
      user: this.profile(user),
    };
  }

  /** the active logins an Admin can preview the app as */
  async viewAsOptions() {
    return (await this.users.list())
      .filter((u: any) => u.status === 'Active')
      .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, distributorName: u.distributorName ?? null }));
  }

  /**
   * An Admin sees the app as another login (a distributor, a finance user ...) without signing in again.
   * The token is read-only (the guard refuses every change) and short-lived.
   */
  async viewAs(adminId: string, userId: string) {
    if (adminId === userId) throw new BadRequestException('This is already your own view.');
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'Active') throw new BadRequestException('This login is not active.');
    return {
      access_token: this.jwt.sign({ sub: user.id, viewer: adminId }, { expiresIn: '2h' }),
      token_type: 'Bearer',
      user: { ...this.profile(user), viewAs: true },
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.profile(user);
  }
}
