import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@nexuspos/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Route-level role guard. Uses the role embedded in the JWT payload —
 * no database hit. Bypasses when no @Roles() metadata is set.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${requiredRoles.join(' or ')}`);
    }
    return true;
  }
}
