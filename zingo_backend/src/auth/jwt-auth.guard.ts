import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from './public.decorator';

/** Registered globally in AuthModule: every route needs a JWT unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const ok = (await super.canActivate(context)) as boolean;
    // an Admin viewing the app as another login only looks: nothing can be changed
    const req = context.switchToHttp().getRequest();
    if (ok && req.user?.viewAs && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      throw new ForbiddenException('This is a preview of another role. Switch back to your own view to make changes.');
    }
    return ok;
  }
}
