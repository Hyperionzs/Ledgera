import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

type RequestWithUser = Request & { user?: AuthUser };

/**
 * Global auth guard.
 * - Bypasses when @Public() is set on the route.
 * - Verifies access token signature + expiry.
 * - Verifies the session (RefreshToken record) is still active — makes logout
 *   and disable take effect immediately, not after token expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    let payload: AuthUser;
    try {
      payload = await this.jwtService.verifyAsync<AuthUser>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Session check — ensures the session is still valid (logout / disable / rotation).
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        userId: true,
        user: { select: { isActive: true } },
      },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session no longer active');
    }
    if (!session.user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    request.user = payload;
    return true;
  }

  private extractToken(request: Request): string | null {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : null;
  }
}
