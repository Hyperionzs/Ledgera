import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { Role } from '@nexuspos/shared';
import { Role as PrismaRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HashService } from './hash.service';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: Role;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly hash: HashService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('EMAIL_TAKEN');

    const passwordHash = await this.hash.hashPassword(dto.password);
    // First registered user becomes OWNER, the rest default CASHIER.
    const userCount = await this.prisma.user.count();
    const role = userCount === 0 ? Role.OWNER : Role.CASHIER;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name ?? null,
        passwordHash,
        role,
      },
    });

    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always run a hash comparison (against a fixed dummy hash when the user
    // doesn't exist) to keep timing consistent — prevents user enumeration.
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await this.hash.verifyPassword(password, passwordHash);

    if (!user || !valid) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      throw new ForbiddenException('ACCOUNT_DISABLED');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash.sha256(refreshToken) },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // Reuse detection: token already rotated → likely stolen. Kill the chain.
    if (session.replacedBy) {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException('REUSED_REFRESH_TOKEN');
    }

    // Revoked without a successor = explicit logout.
    if (session.revokedAt) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
    if (!session.user.isActive) {
      throw new ForbiddenException('ACCOUNT_DISABLED');
    }

    return this.rotateSession(session);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(sessionId: string) {
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session || session.revokedAt || !session.user.isActive) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    return this.sanitize(session.user);
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
    });
    if (!record?.passwordHash) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const matches = await this.hash.verifyPassword(dto.currentPassword, record.passwordHash);
    if (!matches) throw new UnauthorizedException('PASSWORD_MISMATCH');

    const newHash = await this.hash.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { passwordHash: newHash },
    });

    // Password changed → invalidate every session except the current one.
    await this.prisma.refreshToken.updateMany({
      where: {
        userId: user.userId,
        id: { not: user.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------

  /** Fresh login/register: creates a session and returns both tokens. */
  private async issueTokens(user: {
    id: string;
    email: string;
    name: string | null;
    role: PrismaRole;
  }): Promise<AuthTokens> {
    const { accessToken, refreshToken } = await this.createSessionAndTokens(user.id, user);
    return {
      accessToken,
      refreshToken,
      user: this.sanitize(user),
    };
  }

  /** Refresh rotation: revoke old session, create successor, re-issue tokens. */
  private async rotateSession(session: { id: string; userId: string }): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) throw new UnauthorizedException('INVALID_REFRESH_TOKEN');

    const successor = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'pending',
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });

    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedBy: successor.id },
    });

    const { accessToken, refreshToken } = await this.createTokens(user, successor.id);
    return {
      accessToken,
      refreshToken,
      user: this.sanitize(user),
    };
  }

  /** Creates a session record and mints access + refresh tokens for it. */
  private async createSessionAndTokens(
    userId: string,
    user: { id: string; email: string; role: PrismaRole },
  ): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const session = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: 'pending',
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
      },
    });

    const tokens = await this.createTokens(user, session.id);
    return { sessionId: session.id, ...tokens };
  }

  /** Signs access + refresh tokens and stores the refresh digest. */
  private async createTokens(
    user: { id: string; email: string; role: PrismaRole },
    sessionId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, sessionId },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRATION', '15m') as SignOptions['expiresIn'],
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: sessionId },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRATION',
          '7d',
        ) as SignOptions['expiresIn'],
      },
    );

    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { tokenHash: this.hash.sha256(refreshToken) },
    });

    return { accessToken, refreshToken };
  }

  private refreshTtlMs(): number {
    const days = parseInt(this.config.get<string>('JWT_REFRESH_EXPIRATION', '7'), 10);
    return days * 24 * 60 * 60 * 1000;
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private sanitize(user: {
    id: string;
    email: string;
    name: string | null;
    role: PrismaRole;
  }): AuthTokens['user'] {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    };
  }
}

// Fixed bcrypt hash used when the user does not exist — keeps timing equal so
// login responses don't leak whether an email is registered.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8XZzXxJZzXzJZzXxJZzXzJZzXxJZzX';
