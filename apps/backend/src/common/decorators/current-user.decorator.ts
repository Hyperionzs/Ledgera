import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@ledgera/shared';

export interface AuthUser {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
}

/**
 * Injects the authenticated user (set by JwtAuthGuard) into a handler.
 * @example `findAll(@CurrentUser() user: AuthUser)`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
