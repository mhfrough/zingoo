import { Injectable, UnauthorizedException } from '@nestjs/common';
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

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.profile(user);
  }
}
