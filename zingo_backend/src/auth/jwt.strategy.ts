import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Reads the user fresh on every call, so a role change or a disabled account applies at once. */
  async validate(payload: { sub: string; viewer?: string }) {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== 'Active') throw new UnauthorizedException();
    // a "view as" token: the Admin who opened it must still be an active Admin
    if (payload.viewer) {
      const admin = await this.users.findById(payload.viewer);
      if (!admin || admin.status !== 'Active' || admin.role !== 'Admin') throw new UnauthorizedException();
    }
    return {
      id: user.id, email: user.email, name: user.name, role: user.role, seat: user.seat,
      distributorId: user.distributorId, viewAs: payload.viewer ?? null,
    };
  }
}
