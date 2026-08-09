import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryUserDto) {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: this.userSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect,
    });
    if (!user) throw new NotFoundException('NOT_FOUND');
    return user;
  }

  /** Profile update — name/email only. Role and status use dedicated endpoints. */
  async update(id: string, dto: UpdateUserDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('EMAIL_TAKEN');
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.email && { email: dto.email.toLowerCase() }),
          ...(dto.name !== undefined && { name: dto.name }),
        },
        select: this.userSelect,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('NOT_FOUND');
      }
      throw e;
    }
  }

  async updateStatus(id: string, dto: UpdateStatusDto, actorId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('NOT_FOUND');

    // A user must never disable themselves — that is a self lockout.
    if (id === actorId) throw new BadRequestException('SELF_DISABLE');
    // Deactivating the last OWNER would leave the system without an owner.
    if (target.role === 'OWNER' && !dto.isActive && !(await this.hasOtherOwner(id))) {
      throw new BadRequestException('LAST_OWNER');
    }

    // TODO(v2): write audit log entry for status change.
    return this.prisma.user.update({
      where: { id },
      data: { isActive: dto.isActive },
      select: this.userSelect,
    });
  }

  async updateRole(id: string, dto: UpdateRoleDto, actorId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('NOT_FOUND');

    // A user must never change their own role.
    if (id === actorId) throw new BadRequestException('SELF_ROLE_CHANGE');
    // Downgrading the last OWNER leaves the system ownerless.
    if (target.role === 'OWNER' && dto.role !== 'OWNER' && !(await this.hasOtherOwner(id))) {
      throw new BadRequestException('LAST_OWNER');
    }

    // TODO(v2): write audit log entry for role change.
    return this.prisma.user.update({
      where: { id },
      data: { role: dto.role },
      select: this.userSelect,
    });
  }

  /** True when another active OWNER (besides the target) exists. */
  private async hasOtherOwner(targetId: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { role: 'OWNER', isActive: true, id: { not: targetId } },
    });
    return count > 0;
  }

  private readonly userSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.UserSelect;
}
