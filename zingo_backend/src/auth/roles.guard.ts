import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../common/enums';
import { IS_PUBLIC } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

/**
 * Runs after JwtAuthGuard. A route with @Roles/@Read/@Write is limited to those roles.
 * A route without any of them is open to every internal role but closed to distributors.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const user = context.switchToHttp().getRequest().user as { role: Role } | undefined;
    if (!user) return false;

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const ok = allowed ? allowed.includes(user.role) : user.role !== 'Distributor';
    if (!ok) throw new ForbiddenException('Your role does not allow this.');
    return true;
  }
}
