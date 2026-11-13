import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../common/enums';
import { IS_PUBLIC } from './public.decorator';
import { OWN_STATE_KEY, PORTAL_PERMITS, PORTAL_PERMIT_KEY, PortalPermit, ROLES_KEY } from './roles.decorator';
import { PARTNER_ROLES } from './access';

/**
 * Runs after JwtAuthGuard. A route with @Roles/@Read/@Write is limited to those roles.
 * A route without any of them is open to every internal role but closed to partner logins (distributors, manufacturers).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { role: Role; readOnly?: boolean; portalRole?: string } | undefined;
    if (!user) return false;
    const ownState = !!this.reflector.getAllAndOverride<boolean>(OWN_STATE_KEY, targets);
    // a distributor on hold may look but not change anything
    if (user.readOnly && req.method !== 'GET' && !ownState) throw new ForbiddenException('This distributor account is on hold: you can view, but not make changes.');

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const ok = allowed ? allowed.includes(user.role) : !PARTNER_ROLES.includes(user.role);
    if (!ok) throw new ForbiddenException('Your role does not allow this.');
    // a distributor login changes only what its portal role permits (a route without a permit is for the Owner)
    if (user.role === 'Distributor' && req.method !== 'GET' && !ownState) {
      const permit = this.reflector.getAllAndOverride<PortalPermit | undefined>(PORTAL_PERMIT_KEY, targets);
      const roles: readonly string[] = permit ? PORTAL_PERMITS[permit] : ['Owner'];
      if (!roles.includes(user.portalRole ?? 'Owner')) {
        throw new ForbiddenException(`Your portal role (${user.portalRole}) cannot do this; ask your portal Owner.`);
      }
    }
    return true;
  }
}
